import { Readable } from 'stream';
import { URL } from 'url';
import { request } from 'undici';
import fs from 'fs';
import util from 'util';
import zlib from 'zlib';
import gtfsrtBindings from 'gtfs-realtime-bindings';
import JSONStream from 'JSONStream';
import { StreamWriter } from 'n3';
import { format, addHours, addMinutes, addSeconds, addDays } from 'date-fns';
import { Connections2JSONLD } from './Connections2JSONLD.js';
import { Connections2CSV } from './Connections2CSV.js';
import { Connections2Triples } from './Connections2Triples.js';

const readFile = util.promisify(fs.readFile);
const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const { transit_realtime } = gtfsrtBindings;

export class Gtfsrt2LC {
   constructor(options) {
      this._path = options.path;
      this._headers = options.headers || {};
      this._routes = null;
      this._trips = null;
      this._stops = null;
      this._stop_times = null;
      this._tripsByRoute = null;
      this._firstStops = null;
      this._calendar = null;
      this._calendarDates = null;
      this._jsonData = null;
      this._historyDB = null;

      this._uris = options.uris || { // Default URI templates
         stop: "http://example.org/stations/{stops.stop_id}",
         route: "http://example.org/routes/{routeLabel}/{routes.route_id}",
         trip: "http://example.org/trips/{trips.trip_id}/{tripLabel}/{tripStartTime}",
         connection: "http://example.org/connections/{tripLabel}/{depStop}/{tripStartTime}/",
         resolve: {
            "depStop": "connection.departureStop.stop_id",
            "routeLabel": "routes.route_long_name.replace(/\\s/gi, '');",
            "tripLabel": "routes.route_short_name + routes.route_id;",
            "tripStartTime": "format(trips.startTime, \"yyyyMMdd'T'HHmm\");"
         }
      };
   }

   async getUpdatedTrips() {
      let trips = [];
      if (!this.jsonData) {
         await this.parse2Json();
      }

      for (let i in this.jsonData.entity) {
         trips.push(this.jsonData.entity[i]['tripUpdate']['trip']['tripId']);
      }

      return trips;
   }

   async parse2Json() {
      let rawData = await this.getRawData();
      let data = transit_realtime.FeedMessage.decode(rawData);
      this.jsonData = data;
      return data;
   }

   async parse(options) {
      const readable = new Readable({
         objectMode: true,
         read() { }
      });

      try {
         if (!this.jsonData) {
            await this.parse2Json();
         }

         Promise.all(this.jsonData.entity.map(async entity => {
            if (entity.tripUpdate) {
               let tripUpdate = entity.tripUpdate;
               let tripId = tripUpdate.trip.tripId;

               const timestamp = tripUpdate.timestamp || this.jsonData.header.timestamp;

               // Check if tripId is directly provided or has to be found from GTFS source,
               // as specified in https://gtfs.org/reference/realtime/v2/#message-tripdescriptor
               if (!tripId && tripUpdate.trip.routeId) {
                  let deduced = await this.deduceTripId(tripUpdate.trip.routeId, tripUpdate.trip.startTime,
                     tripUpdate.trip.startDate, tripUpdate.trip.directionId);
                  tripId = deduced ? deduced['trip_id'] : null;
               }

               let r = null;
               let t = null;
               let st = null;

               try {
                  // Check if there is static data about the update, skip if not
                  t = await this.getTrip(tripId);
                  r = await this.getRoute(t['route_id']);
                  // Original static schedule for this trip
                  st = await this.getStopTimes(tripId);
                  if (!t || !st || st.length < 2) {
                     //console.warn(`No data found in GTFS source for trip: ${tripId}`);
                     return;
                  }
               } catch (err) {
                  //console.warn(`No data found in GTFS source for trip: ${tripId}`);
                  return;
               }

               // Figure service date and trip start time
               let serviceDay = null;
               let tripStartTime = null;

               if (tripUpdate.trip.startDate) {
                  const rawStartDate = tripUpdate.trip.startDate;
                  serviceDay = new Date(
                     rawStartDate.substr(0, 4),
                     parseInt(rawStartDate.substr(4, 2)) - 1,
                     rawStartDate.substr(6, 2)
                  );
                  if (tripUpdate.trip.startTime) {
                     tripStartTime = this.addDuration(serviceDay, this.parseGTFSDuration(tripUpdate.trip.startTime));
                  } else {
                     // Extract from static data
                     tripStartTime = this.addDuration(
                        serviceDay,
                        this.parseGTFSDuration((await this.getStopTimes(tripId))[0]['departure_time'])
                     );
                  }
               } else {
                  // Extract from static data
                  const serviceObj = this.calendar.get(t['service_id']);
                  const depTime = (await this.getStopTimes(tripId))[0]['departure_time'];
                  serviceDay = this.findTripStartDate(depTime, serviceObj);
                  tripStartTime = this.addDuration(
                     serviceDay,
                     this.parseGTFSDuration((await this.getStopTimes(tripId))[0]['departure_time'])
                  );
               }

               // Check if the trip has been canceled or not
               let type = this.getConnectionType(entity);
               // List of live updates for each stop
               let stopTimeUpdates = tripUpdate.stopTimeUpdate;

               /*
                * Some operators provide only delays for some of the stops 
                * of a trip in their GTFS-RT. According to the spec, if a stop update is not provided,
                * it takes the same delays of the previous provided stop update.
                */

               // Fill in the stop updates gaps according to the spec
               let completedUpdates = this.completeUpdates(st, stopTimeUpdates, serviceDay, timestamp);

               if (completedUpdates.length > 1) {
                  // Index to retrieve pickUpType and dropOffType
                  let pdIndex = parseInt(this.findIndex(completedUpdates[0]['stopId'], st));
                  // Iterate to form the Connections
                  for (let [j, cu] of completedUpdates.entries()) {
                     // Process updates in pairs to form Connections
                     if (j < completedUpdates.length - 1) {
                        try {
                           /*
                            * GTFS-RT provides the delays of arriving and departing from/at a stop, we use the connection
                            * between 2 stops.
                            *     Departure       Arrival   Departure        Arrival  
                            *   +-------------------------+-------------------------+
                            */

                           // Basic attributes of a Connection
                           let departureStop = cu['stopId'];
                           let arrivalStop = completedUpdates[j + 1]['stopId']
                           let departureTime = new Date(cu['departure']['time'] * 1000);
                           let arrivalTime = new Date(completedUpdates[j + 1]['arrival']['time'] * 1000);
                           let departureDelay = cu['departure']['delay'];
                           let arrivalDelay = completedUpdates[j + 1]['arrival']['delay'];

                           // Check if this is a new update based on recorded Connections history (if any)
                           // and skip it if is not new.
                           if (this.historyDB && !(await this.differentialUpdate({
                              route: r,
                              trip: t,
                              stopTimes: st,
                              cu: await this.getStop(cu.stopId),
                              ncu: await this.getStop(completedUpdates[j + 1].stopId),
                              pdIndex,
                              startTime: format(tripStartTime, 'H:mm:ss'),
                              startDate: format(serviceDay, 'yyyMMdd'),
                              departureDelay,
                              arrivalDelay,
                              type
                           }))) {
                              return;
                           }

                           // Add start time to trip object
                           t.startTime = tripStartTime;

                           // Build JSON Connection
                           let json_connection = {
                              type,
                              departureStop: await this.getStop(departureStop),
                              departureTime: departureTime,
                              arrivalStop: await this.getStop(arrivalStop),
                              arrivalTime: arrivalTime,
                              departureDelay,
                              arrivalDelay,
                              trip: t,
                              route: r,
                              headsign: t['trip_headsign'],
                              pickup_type: cu['scheduleRelationship'] || st[pdIndex]['pickup_type'],
                              drop_off_type: completedUpdates[j + 1]['scheduleRelationship'] || st[pdIndex + 1]['drop_off_type']
                           };

                           // Advance pdIndex
                           pdIndex++;
                           readable.push(json_connection);
                        }
                        catch (err) {
                           console.error('Error parsing update for Trip ' + tripId + ': ');
                           console.error(err);
                           continue;
                        }
                     }
                  }
               }
            }
         })).then(() => {
            readable.push(null);
         }).catch(err => {
            console.error(err);
            readable.push(null);
         });
      } catch (err) {
         console.error(err);
         readable.push(null);
      }

      // Serialize data according to specified format (default: json) 
      if (options.format === 'jsonld') {
         if (!options.objectMode) {
            return readable.pipe(new Connections2JSONLD(true, this.uris)).pipe(JSONStream.stringify(false));
         } else {
            return readable.pipe(new Connections2JSONLD(true, this.uris));
         }
      } else if (options.format === 'csv') {
         return readable.pipe(new Connections2CSV());
      } else if (options.format === 'ntriples') {
         return readable.pipe(new Connections2Triples(this.uris)).pipe(new StreamWriter({ format: 'N-Triples' }));
      } else if (options.format === 'turtle') {
         return readable.pipe(new Connections2Triples(this.uris)).pipe(new StreamWriter({
            prefixes: {
               xsd: 'http://www.w3.org/2001/XMLSchema#',
               lc: 'http://semweb.mmlab.be/ns/linkedconnections#',
               gtfs: 'http://vocab.gtfs.org/terms#'
            }
         }));
      } else {
         if (!options.objectMode) {
            return readable.pipe(JSONStream.stringify(false));
         } else {
            return readable;
         }
      }
   }

   async getRawData() {
      // Download/access static GTFS feed
      if (this.path.startsWith('http') || this.path.startsWith('https')) {
         const download_url = new URL(this.path);
         if (!download_url) {
            reject('Please provide a valid url or a path to a GTFS-RT feed');
         } else {
            const res = await request(this.path, {
               method: 'GET',
               headers: this.headers,
               maxRedirections: 10
            });
            return await this.handleResponse(res);
         }
      } else {
         if (fs.existsSync(this.path)) {
            return await readFile(this.path);
         } else {
            throw new Error('Please provide a valid url or a path to a GTFS-RT feed');
         }
      }
   }

   handleResponse(res) {
      return new Promise(async (resolve, reject) => {
         if (res.statusCode >= 400) {
            reject(new Error('Request ' + this.path + ' failed with HTTP response code ' + res.statusCode));
         } else {
            let encoding = res.headers['content-encoding']
            let responseStream = await res.body;
            let buffer = false;

            if (encoding && encoding == 'gzip') {
               responseStream = res.pipe(zlib.createGunzip());
            } else if (encoding && encoding == 'deflate') {
               responseStream = res.pipe(zlib.createInflate())
            }

            responseStream.on('data', chunk => {
               if (!buffer) {
                  buffer = chunk;
               } else {
                  buffer = Buffer.concat([buffer, chunk], buffer.length + chunk.length);
               }
            }).on('error', err => {
               reject(err);
            }).on('end', () => {
               resolve(buffer);
            });
         }
      });
   }

   async deduceTripId(routeId, startTime, startDate, directionId) {
      if (this.tripsByRoute && this.firstStops && this.calendar && this.calendarDates) {
         let trips = [];
         let winner = null;

         // Get all trips for the given route
         let tripsByRoute = this.tripsByRoute.get(routeId);
         if (!tripsByRoute) {
            console.warn(`No trips found for route ${routeId}`);
            return null;
         }

         await Promise.all(tripsByRoute.map(async t => {
            if (this.trips instanceof Map) {
               trips.push(this.trips.get(t));
            } else {
               trips.push(await this.trips.get(t));
            }
         }));

         // Filter trips with the same direction
         trips = trips.filter(t => parseInt(t['direction_id']) === directionId);
         if (trips.length === 0) return null;

         // Filter trips with the same start time
         trips = trips.filter(t => {
            let sto = this.firstStops.get(t['trip_id']);
            if (sto) {
               if (sto['departure_time'] === startTime) {
                  return t;
               } else {
                  // Try adding 24 hours to startTime (noticed this inconsistency on HSL Helsinki GTFS-RT)
                  let nst = `${parseInt(startTime.split(':')[0]) + 24}:${startTime.substring(3)}`;
                  if (sto['departure_time'] === nst) {
                     t['startTime'] = nst;
                     return t;
                  }
               }
            }
         });
         if (trips.length === 0) return null;

         // Find the trip that runs on the same day
         let today = new Date(startDate.substring(0, 4), parseInt(startDate.substring(4, 6)) - 1, startDate.substring(6, 8));
         for (let i = 0; i < trips.length; i++) {
            const service = await this.calendar.get(trips[i]['service_id']);
            const exceptions = this.calendarDates.get(trips[i]['service_id']) || {};
            const minDate = new Date(service['start_date'].substring(0, 4), parseInt(service['start_date'].substring(4, 6)) - 1, service['start_date'].substring(6, 8));
            const maxDate = new Date(service['end_date'].substring(0, 4), parseInt(service['end_date'].substring(4, 6)) - 1, service['end_date'].substring(6, 8));

            if (today >= minDate && today <= maxDate) {
               const dayOfWeek = days[today.getDay()];
               if (service[dayOfWeek] === '1' && exceptions[startDate] !== '2') {
                  winner = trips[i];
               }
            } else {
               if (exceptions[startDate] === '1') {
                  winner = trips[i];
               }
            }
         }

         if (!winner) {
            console.warn(`No trip found for Route ${routeId}, Start Time ${startTime} and Start Date ${startDate}`);
         }

         return winner;
      } else {
         console.warn('Could not perform Trip deduction due to missing indexes. Try running with -d option.');
         return null;
      }
   }

   findTripStartDate(depTime, service) {
      const now = new Date();
      const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
      const today = format(now, 'EEEE').toLowerCase();
      const tomorrow = days[days.indexOf(today) > 5 ? 0 : days.indexOf(today) + 1];
      const yesterday = days[days.indexOf(today) < 1 ? 6 : days.indexOf(today) - 1];

      const todayServiceDate = this.addDuration(
         new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
         this.parseGTFSDuration(depTime)
      );
      const tomorrowServiceDate = addDays(todayServiceDate, 1);
      const yesterdayServiceDate = addDays(todayServiceDate, -1);

      const todayDistance = service[today] === '1' ? Math.abs(now - todayServiceDate) : Number.POSITIVE_INFINITY;
      const tomorrowDistance = service[tomorrow] === '1' ? Math.abs(now - tomorrowServiceDate) : Number.POSITIVE_INFINITY;
      const yesterdayDistance = service[yesterday] === '1' ? Math.abs(now - yesterdayServiceDate) : Number.POSITIVE_INFINITY;

      if (todayDistance === Math.min(todayDistance, tomorrowDistance, yesterdayDistance)) {
         return todayServiceDate.setUTCHours(0, 0, 0, 0);
      }

      if (tomorrowDistance === Math.min(todayDistance, tomorrowDistance, yesterdayDistance)) {
         return tomorrowServiceDate.setUTCHours(0, 0, 0, 0);
      }

      if (yesterdayDistance === Math.min(todayDistance, tomorrowDistance, yesterdayDistance)) {
         return yesterdayServiceDate.setUTCHours(0, 0, 0, 0);
      }
   }

   getConnectionType(entity) {
      let scheduleRelationship = entity.tripUpdate.trip.scheduleRelationship;
      // Look for CANCELED instead of CANCELLED because that is how gtfs-realtime-bindings has it (american english)
      if (entity.isDeleted || scheduleRelationship == 3 || scheduleRelationship === 'CANCELED') {
         return 'CancelledConnection';
      }
      else {
         return 'Connection';
      }
   }

   completeUpdates(staticStops, liveStops, serviceDay, timestamp) {
      try {
         let completedUpdates = [];
         let liveIndex = 0;

         for (let i in staticStops) {
            let staticStop = staticStops[i]['stop_id'];
            let liveStop = null;
            let liveStopSequence = null;

            if (liveStops[liveIndex]) {
               // Determine the stopId that is being targeted by this update 
               if (liveStops[liveIndex]['stopId']) {
                  liveStop = liveStops[liveIndex]['stopId'];
               }

               // Use stop sequence as a reference if defined, to avoid wrong updates 
               // in trips visiting the same stop more than once. 
               if (liveStops[liveIndex]['stopSequence']) {
                  liveStopSequence = liveStops[liveIndex]['stopSequence'];
                  let stop = this.findStopBySequence(liveStopSequence, staticStops);
                  if (stop) {
                     liveStop = stop['stop_id'];
                  }
               }
            }

            if (staticStop === liveStop) {
               // Check the update is complete and add it to the complete list
               let verifiedUpdate = this.checkUpdate(
                  liveStops[liveIndex],
                  completedUpdates[completedUpdates.length - 1],
                  staticStops[i],
                  i,
                  staticStops.length,
                  serviceDay,
                  timestamp
               );

               completedUpdates.push(verifiedUpdate);
               liveIndex++;
            } else {
               let staticIndex = -1;

               if (liveStop) {
                  staticIndex = this.findIndex(liveStop, staticStops);
               } else {
                  if (liveStops[liveIndex]) {
                     // Skip stops that are not defined in the static schedule (may happen with joining or splitting trains)
                     liveIndex++;
                     continue;
                  }
               }

               // Check if we are already adding static stops to fill in the blanks 
               // or if we are going to add the first stop update
               if ((staticIndex < 0 || liveIndex > 0) && completedUpdates.length > 0) {
                  // We are already filling the blanks, then add this static stop using the 
                  // departure delay of the previous update
                  let prevDelay = completedUpdates[completedUpdates.length - 1]['departure']['delay'];
                  completedUpdates.push({
                     'stopId': staticStops[i]['stop_id'],
                     'arrival': {
                        'delay': prevDelay,
                        'time': (this.addDuration(serviceDay, this.parseGTFSDuration(staticStops[i]['arrival_time'])).getTime() / 1000) + prevDelay
                     },
                     'departure': {
                        'delay': prevDelay,
                        'time': (this.addDuration(serviceDay, this.parseGTFSDuration(staticStops[i]['departure_time'])).getTime() / 1000) + prevDelay
                     }
                  });
               } else if (liveIndex === 0 && i == staticIndex - 1) {
                  // We are going to add the first stop to the update list. 
                  // Add this previous static stop to the update list to generate an updated connection with arrival delay,
                  // only if the arrival delay is declared.
                  if (liveStops[0]['arrival']) {
                     completedUpdates.push({
                        'stopId': staticStops[i]['stop_id'],
                        'departure': {
                           'delay': 0,
                           'time': this.addDuration(serviceDay, this.parseGTFSDuration(staticStops[i]['departure_time'])).getTime() / 1000
                        }
                     });
                  }
               }
            }
         }

         return completedUpdates;
      } catch (err) {
         console.error(err);
      }
   }

   checkUpdate(update, prevUpdate, staticData, staticIndex, staticLength, serviceDay, timestamp) {
      try {
         // Add the stopId if missing. Could be absent in GTFS-RT v2.0
         if (!update['stopId']) {
            update['stopId'] = staticData['stop_id'];
         }

         // Check if delays are present and explicitly add them if not, 
         // by calculating the difference between static and live times 
         if (update['departure'] && typeof update['departure'].toJSON === 'function'
            && update['departure'].toJSON()['time'] && !update['departure'].toJSON()['delay']) {
            let stc = this.addDuration(serviceDay, this.parseGTFSDuration(staticData['departure_time']));
            let live = new Date(update['departure']['time'] * 1000);
            update['departure']['delay'] = (live.getTime() - stc.getTime()) / 1000;
         }
         if (update['arrival'] && typeof update['arrival'].toJSON === 'function'
            && update['arrival'].toJSON()['time'] && !update['arrival'].toJSON()['delay']) {
            let stc = this.addDuration(serviceDay, this.parseGTFSDuration(staticData['arrival_time']));
            let live = new Date(update['arrival']['time'] * 1000);
            update['arrival']['delay'] = (live.getTime() - stc.getTime()) / 1000;
         }

         // Check if departure time is explicitly defined. In some cases only the delay is given
         if (update['departure']) {
            if (typeof update['departure']['time'] === 'object') {
               if (update['departure']['time'].toNumber() === 0) {
                  update['departure']['time'] = (this.addDuration(serviceDay, this.parseGTFSDuration(staticData['departure_time'])).getTime() / 1000) + update['departure']['delay'];
               }
            } else {
               if (!update['departure']['time']) {
                  update['departure']['time'] = (this.addDuration(serviceDay, this.parseGTFSDuration(staticData['departure_time'])).getTime() / 1000) + update['departure']['delay'];
               }
            }
         } else {
            // If this stop is not the last of the trip and the stop update is missing departure info
            // add it manually taking into account the arrival delay at this stop
            if (staticIndex < staticLength - 1 && update['arrival']) {
               update['departure'] = {
                  'delay': update['arrival']['delay'] | 0,
                  'time': (this.addDuration(serviceDay, this.parseGTFSDuration(staticData['departure_time'])).getTime() / 1000) + update['arrival']['delay']
               }
            } else {
               // Fallback to static data
               update['departure'] = {
                  'delay': 0,
                  'time': (this.addDuration(serviceDay, this.parseGTFSDuration(staticData['departure_time'])).getTime() / 1000)
               }
            }
         }

         // Check if arrival time is explicitly defined. In some cases only the delay is given
         if (update['arrival']) {
            if (typeof update['arrival']['time'] === 'object') {
               if (update['arrival']['time'].toNumber() === 0) {
                  update['arrival']['time'] = (this.addDuration(serviceDay, this.parseGTFSDuration(staticData['arrival_time'])).getTime() / 1000) + update['arrival']['delay'];
               }
            } else {
               if (!update['arrival']['time']) {
                  update['arrival']['time'] = (this.addDuration(serviceDay, this.parseGTFSDuration(staticData['arrival_time'])).getTime() / 1000) + update['arrival']['delay'];
               }
            }
         } else {
            // If the stop update is missing arrival info and is not the first stop of the trip
            // add it manually taking into account the departure delay of the previous stop (if any)
            if (staticIndex > 0 && prevUpdate) {
               // We need to make sure that adding the departure delay of the previous stop 
               // to the arrival time of this stop won't cause inconsistent times,
               // i.e. arrival > departure.
               let depTime = update['departure']['time'];
               let prevDepDelay = prevUpdate ? prevUpdate['departure']['delay'] : 0;
               const originalArrTime = this.addDuration(serviceDay, this.parseGTFSDuration(staticData['arrival_time'])).getTime() / 1000;
               let newArrTime = originalArrTime + prevDepDelay;

               if (newArrTime <= depTime) {
                  update['arrival'] = {
                     'delay': prevDepDelay,
                     'time': newArrTime
                  }
               } else {
                  // Check if we are dealing with predictions or with facts (is this really a fact?).
                  if (depTime < timestamp) {
                     // This already happened, so we assume we can trust this delay better.
                     // Set the arrival according to the departure delay and change the
                     // departure of the previous one to fit this one too.
                     update['arrival'] = {
                        'delay': update['departure']['delay'],
                        'time': originalArrTime + update['departure']['delay']
                     }
                     prevUpdate['departure']['time'] = prevUpdate['departure']['time'] - prevDepDelay + update['departure']['delay'];
                     prevUpdate['departure']['delay'] = update['departure']['delay'];
                  } else {
                     // This is a prediction so we choose to trust the delay of the previous one
                     // to maintain consistency.
                     const originalDepTime = this.addDuration(serviceDay, this.parseGTFSDuration(staticData['departure_time'])).getTime() / 1000;
                     update['arrival'] = {
                        'delay': prevDepDelay,
                        'time': newArrTime
                     }
                     update['departure']['time'] = originalDepTime + prevDepDelay;
                     update['departure']['delay'] = prevDepDelay;

                  }
               }
            } else { /* This should never happen */ }
         }

         // Check for inconsistencies between this update and the previous
         if (prevUpdate && update['departure'] && prevUpdate['departure']['time'] > update['arrival']['time']) {
            // Enforce previous delay on this update to keep consistency
            let prevDepDelay = prevUpdate ? prevUpdate['departure']['delay'] : 0;
            const originalArrTime = this.addDuration(serviceDay, this.parseGTFSDuration(staticData['arrival_time'])).getTime() / 1000;
            const originalDepTime = this.addDuration(serviceDay, this.parseGTFSDuration(staticData['departure_time'])).getTime() / 1000;
            let newArrTime = originalArrTime + prevDepDelay;

            update['arrival'] = {
               'delay': prevDepDelay,
               'time': newArrTime
            }

            // Check that this change didn't create another inconsistency for this stop
            if (update['arrival']['time'] > update['departure']['time']) {
               update['departure']['time'] = originalDepTime + prevDepDelay;
               update['departure']['delay'] = prevDepDelay;
            }

         }
      } catch (err) {
         console.error(err);
         console.error('Issue encountered while processing this update: ', JSON.stringify(update, null, 3));
         console.error('From this trip: ', JSON.stringify(staticData, null, 3));
      }

      return update;
   }

   async differentialUpdate(params) {
      const {
         route,
         trip,
         stopTimes,
         cu,
         ncu,
         pdIndex,
         startTime,
         startDate,
         departureDelay,
         arrivalDelay,
         type
      } = params;

      // Build Connection's original rule as in gtfs2lc
      const depStopId = cu['stop_code'] && cu['stop_code'] !== '' ? cu['stop_code'] : cu['stop_id'];
      const arrStopId = ncu['stop_code'] && ncu['stop_code'] !== '' ? ncu['stop_code'] : ncu['stop_id'];

      const uniqueId = [
         route['route_long_name'].replace(/\s/g, ''),
         trip['trip_short_name'],
         depStopId,
         arrStopId,
         startTime,
         stopTimes[pdIndex]['departure_time'],
         stopTimes[pdIndex + 1]['arrival_time'],
         stopTimes[pdIndex]['pickup_type'],
         stopTimes[pdIndex + 1]['drop_off_type']
      ].join('/');

      try {
         const old = await this.historyDB.get(uniqueId);
         if (old === undefined) {
            // This is a completely new Connection rule
            const update = {
               [startDate]: {
                  departureDelay,
                  arrivalDelay,
                  type
               }
            };
            await this.historyDB.put(uniqueId, update);
         } else {
            // Connection found in history store, check if there has been an update for it
            const currServiceDate = old[startDate];
            if (currServiceDate) {
               // Check if delays or the connection state have changed
               if (currServiceDate.departureDelay !== departureDelay
                  || currServiceDate.arrivalDelay !== arrivalDelay
                  || currServiceDate.type !== type) {
                  // This is a new update
                  const update = Object.assign({}, old);
                  update[startDate] = {
                     departureDelay,
                     arrivalDelay,
                     type
                  }
                  await this.historyDB.put(uniqueId, update);
               } else {
                  // Nothing has changed for this connection, so skip it
                  return false;
               }
            } else {
               // This is a new service date for this connection rule.
               // Not sure this will ever happen
               const update = Object.assign({}, old);
               update[startDate] = {
                  departureDelay,
                  arrivalDelay,
                  type
               }
               await this.historyDB.put(uniqueId, update);
            }
         }
      } catch (err) {
         if (err.code === 'LEVEL_NOT_FOUND') {

         } else {
            // Something went wrong
            throw err;
         }
      }
      return true;
   }

   findStopBySequence(stopSequence, staticStops) {
      for (let i in staticStops) {
         if (staticStops[i]['stop_sequence'] == stopSequence) {
            return staticStops[i];
         }
      }
   }

   findIndex(stopId, staticStops) {
      for (let i in staticStops) {
         if (staticStops[i]['stop_id'] === stopId) {
            return i;
         }
      }
   }

   addDuration(date, duration) {
      return addSeconds(addMinutes(addHours(date, duration.hours), duration.minutes), duration.seconds);
   }

   parseGTFSDuration(durationString) {
      let [hours, minutes, seconds] = durationString.split(':').map((val) => { return parseInt(val); });
      // Be forgiving to durations that do not follow the spec e.g., (12:00 instead of 12:00:00)
      return { hours, minutes, seconds: seconds ? seconds : 0 };
   }

   setIndexes(indexes) {
      this._routes = indexes.routes;
      this._trips = indexes.trips;
      this._stops = indexes.stops;
      this._stop_times = indexes.stop_times;
      this._tripsByRoute = indexes.tripsByRoute;
      this._firstStops = indexes.firstStops;
      this._calendar = indexes.calendar;
      this._calendarDates = indexes.calendarDates;
      this._historyDB = indexes.historyDB;
   }

   async getTrip(id) {
      if (this.trips instanceof Map) {
         return this.trips.get(id);
      } else {
         return await this.trips.get(id);
      }
   }

   async getRoute(id) {
      if (this.routes instanceof Map) {
         return this.routes.get(id);
      } else {
         return await this.routes.get(id);
      }
   }

   async getStop(id) {
      if (this.stops instanceof Map) {
         return this.stops.get(id);
      } else {
         return await this.stops.get(id);
      }
   }

   async getStopTimes(id) {
      if (this.stop_times instanceof Map) {
         return this.stop_times.get(id);
      } else {
         return await this.stop_times.get(id);
      }
   }

   get path() {
      return this._path;
   }

   get routes() {
      return this._routes;
   }

   get trips() {
      return this._trips;
   }

   get stops() {
      return this._stops;
   }

   set stops(stops) {
      this._stops = stops;
   }

   get stop_times() {
      return this._stop_times;
   }

   get tripsByRoute() {
      return this._tripsByRoute;
   }

   get firstStops() {
      return this._firstStops;
   }

   get calendar() {
      return this._calendar;
   }

   get calendarDates() {
      return this._calendarDates;
   }

   get uris() {
      return this._uris;
   }

   get headers() {
      return this._headers;
   }

   get jsonData() {
      return this._jsonData;
   }

   set jsonData(data) {
      this._jsonData = data;
   }

   get historyDB() {
      return this._historyDB;
   }
}
