const { Readable } = require('stream');
const url = require('url');
const http = require('follow-redirects').http;
const https = require('follow-redirects').https;
const fs = require('fs');
const zlib = require('zlib');
const gtfsrt = require('gtfs-realtime-bindings').transit_realtime;
const uri_templates = require('uri-templates');
const jsonldstream = require('jsonld-stream');
const N3 = require('n3');
const { format, addHours, addMinutes, addSeconds } = require('date-fns');
const Connections2JSONLD = require('./Connections2JSONLD');
const Connections2CSV = require('./Connections2CSV');
const Connections2Triples = require('./Connections2Triples');

class Gtfsrt2LC {
    constructor(path, routes, trips, stops, stop_times, uris) {
        this._path = path;
        this._routes = routes;
        this._trips = trips;
        this._stops = stops;
        this._stop_times = stop_times;
        this._uris = uris;
    }

    async parse(format, asObject) {
        const readable = new Readable({
            objectMode: true,
            read() { }
        });

        try {
            let rawData = await this.getRawData();
            let feed = gtfsrt.FeedMessage.decode(rawData);

            Promise.all(feed.entity.map(async entity => {
                if (entity.tripUpdate) {
                    let tripUpdate = entity.tripUpdate;
                    let tripId = tripUpdate.trip.tripId;
                    let startDate = tripUpdate.trip.startDate;
                    let serviceDay = new Date(startDate.substr(0, 4), parseInt(startDate.substr(4, 2)) - 1, startDate.substr(6, 2));
                    let tripStartTime = this.addDuration(serviceDay, this.parseGTFSDuration(tripUpdate.trip.startTime));

                    // Check if there is static data about the update, skip if not
                    if (!this.trips.get(tripId)) {
                        console.error('Trip id ' + tripId + ' not found in current GTFS static data');
                        return;
                    }

                    // Check if train is canceled or not
                    let type = this.getConnectionType(entity);
                    if (type === 'CancelledConnection') {

                    }

                    // List of live updates for each stop
                    let stopTimeUpdates = tripUpdate.stopTimeUpdate;
                    // Original static schedule for this trip
                    let stopTimesSchedule = this.stop_times.get(tripId);


                    /*
                     * The SNCB for example only provides delays for some of the stops 
                     * of a trip in their GTFS-RT. According to the spec, if a stop update is not provided,
                     * it takes the same delays of the previous provided stop update. 
                     * We need to fetch the complete trip of the vehicle from the `stop_times.txt` file, 
                     * in order to give a correct trip update.
                     */

                    // Fill in the stop updates gaps according to the spec
                    let completedUpdates = this.completeUpdates(stopTimesSchedule, stopTimeUpdates, serviceDay);

                    if (completedUpdates.length > 0) {
                        // Index to retrieve pickUpType and dropOffType
                        let pdIndex = parseInt(this.findIndex(completedUpdates[0]['stopId'], stopTimesSchedule));
                        // Iterate to form the Connections
                        for (let j = 0; j < completedUpdates.length - 1; j++) {
                            try {
                                /*
                                 * GTFS-RT provides the delays from arriving and departing in a stop, we use the connection
                                 * between 2 stops.
                                 *     Departure       Arrival   Departure        Arrival  
                                 *   +-------------------------+-------------------------+
                                 */

                                // Basic attributes of a Connection
                                let departureStop = completedUpdates[j]['stopId'];
                                let arrivalStop = completedUpdates[j + 1]['stopId']
                                let departureTime = new Date(completedUpdates[j]['departure']['time'] * 1000);
                                let arrivalTime = new Date(completedUpdates[j + 1]['arrival']['time'] * 1000);
                                let departureDelay = completedUpdates[j]['departure']['delay'];
                                let arrivalDelay = completedUpdates[j + 1]['arrival']['delay'];

                                let raw_connection = {
                                    departureStop: departureStop,
                                    departureTime: departureTime,
                                    arrivalStop: arrivalStop,
                                    arrivalTime: arrivalTime
                                };

                                // Predefined URI templates 
                                let stopTemplate = uri_templates(this.uris['stop']);
                                let routeTemplate = uri_templates(this.uris['route']);
                                let tripTemplate = uri_templates(this.uris['trip']);
                                let connectionTemplate = uri_templates(this.uris['connection']);

                                // Resolve values for URIs
                                let departureStopURI = this.resolveURI(stopTemplate, departureStop, null, tripId, tripStartTime, raw_connection, this.uris['resolve']);
                                let arrivalStopURI = this.resolveURI(stopTemplate, null, arrivalStop, tripId, tripStartTime, raw_connection, this.uris['resolve']);
                                let routeURI = this.resolveURI(routeTemplate, null, null, tripId, tripStartTime, raw_connection, this.uris['resolve']);
                                let tripURI = this.resolveURI(tripTemplate, null, null, tripId, tripStartTime, raw_connection, this.uris['resolve']);
                                let connectionURI = this.resolveURI(connectionTemplate, null, null, tripId, tripStartTime, raw_connection, this.uris['resolve']);
                                // Determine Pick Up & Drop Off types
                                let pickupType = this.resolveScheduleRelationship(completedUpdates[j]['scheduleRelationship'], stopTimesSchedule[pdIndex]['pickup_type']);
                                let dropOffType = this.resolveScheduleRelationship(completedUpdates[j + 1]['scheduleRelationship'], stopTimesSchedule[pdIndex + 1]['drop_off_type']);

                                // Advance pdIndex
                                pdIndex++;

                                // Build LC
                                let linked_connection = {
                                    "@id": connectionURI,
                                    "@type": type,
                                    "departureStop": departureStopURI,
                                    "arrivalStop": arrivalStopURI,
                                    "departureTime": departureTime.toISOString(),
                                    "arrivalTime": arrivalTime.toISOString(),
                                    "departureDelay": departureDelay,
                                    "arrivalDelay": arrivalDelay,
                                    "direction": this.trips.get(tripId).trip_headsign,
                                    "trip": tripURI,
                                    "route": routeURI,
                                    "gtfs:pickupType": pickupType,
                                    "gtfs:dropOffType": dropOffType
                                }

                                readable.push(linked_connection);
                            }
                            catch (err) {
                                console.error(err);
                                console.error('Null value found in stop times sequence for Trip ' + tripId);
                                continue;
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
        if (format === 'jsonld') {
            if (!asObject) {
                return readable.pipe(new Connections2JSONLD()).pipe(new jsonldstream.Serializer());
            } else {
                return readable.pipe(new Connections2JSONLD());
            }
        } else if (format === 'csv') {
            return readable.pipe(new Connections2CSV());
        } else if (format === 'ntriples') {
            return readable.pipe(new Connections2Triples()).pipe(new N3.StreamWriter({ format: 'N-Triples' }));
        } else if (format === 'turtle') {
            return readable.pipe(new Connections2Triples()).pipe(new N3.StreamWriter({
                prefixes: {
                    xsd: 'http://www.w3.org/2001/XMLSchema#',
                    lc: 'http://semweb.mmlab.be/ns/linkedconnections#',
                    gtfs: 'http://vocab.gtfs.org/terms#'
                }
            }));
        } else {
            if (!asObject) {
                return readable.pipe(new jsonldstream.Serializer());
            } else {
                return readable;
            }
        }
    }

    getRawData() {
        return new Promise((rsv, rjt) => {
            // Download/access static GTFS feed
            if (this.path.startsWith('http') || this.path.startsWith('https')) {
                let download_url = url.parse(this.path);
                if (!download_url) {
                    reject('Please provide a valid url or a path to a GTFS-RT feed');
                } else {
                    if (download_url.protocol === 'https:') {
                        let req = https.request(download_url, res => this.handleResponse(res, rsv, rjt));
                        req.on('error', err => {
                            rjt(err);
                        });
                        req.end();
                    } else {
                        let req = http.request(download_url, res => this.handleResponse(res, rsv, rjt));
                        req.on('error', err => {
                            rjt(err);
                        });
                        req.end();
                    }
                }
            } else {
                if (!fs.existsSync(this.path)) {
                    rjt('Please provide a valid url or a path to a GTFS-RT feed');
                } else {
                    fs.readFile(this.path, (err, data) => {
                        if (err) rjt(err);
                        rsv(data);
                    });
                }
            }
        });
    }

    handleResponse(res, rsv, rjt) {
        let encoding = res.headers['content-encoding']
        let responseStream = res;
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
            rjt(err);
        }).on('end', () => {
            rsv(buffer);
        });
    }

    getConnectionType(entity) {
        if (entity.isDeleted || entity.tripUpdate.trip.scheduleRelationship == 3) {
            return 'CancelledConnection'; // TODO: Add CancelledConnection class to LC vocabulary
        }
        else {
            return 'Connection';
        }
    }

    completeUpdates(staticStops, liveStops, serviceDay) {
        try {
            let completedUpdates = [];
            let liveIndex = 0;

            for (let i in staticStops) {
                let staticStop = staticStops[i]['stop_id'];
                let liveStop = null;
                if (liveStops[liveIndex]) {
                    liveStop = liveStops[liveIndex]['stopId'];
                }

                if (staticStop === liveStop) {
                    // Add updated stop
                    completedUpdates.push(liveStops[liveIndex]);
                    liveIndex++;
                } else {
                    let staticIndex = -1;
                    if (liveStop) {
                        staticIndex = this.findIndex(liveStop, staticStops);
                    }

                    if (!staticIndex) {
                        // Skip stops that are not defined in the static schedule (may happen with joining or splitting trains)
                        liveIndex++;
                        continue;
                    }

                    if ((staticIndex < 0 || liveIndex > 0) && completedUpdates.length > 0) {
                        // Add this static stop using the delay (either departure or arrival) of the previous live update
                        let prevDelay = 0;
                        if (liveStops[liveIndex - 1]['departure']) {
                            prevDelay = liveStops[liveIndex - 1]['departure']['delay'];
                        } else {
                            if (completedUpdates[completedUpdates.length - 1]['stopId'] === liveStops[liveIndex - 1]['stopId']) {
                                // If the last received live update is incomplete (i.e. does not have a departure) then complete it
                                // using the given arrival delay
                                let si = this.findIndex(completedUpdates[completedUpdates.length - 1]['stopId'], staticStops);
                                completedUpdates[completedUpdates.length - 1]['departure'] = {
                                    'delay': completedUpdates[completedUpdates.length - 1]['arrival']['delay'],
                                    'time': (this.addDuration(serviceDay, this.parseGTFSDuration(staticStops[si]['departure_time'])).getTime() / 1000)
                                        + completedUpdates[completedUpdates.length - 1]['arrival']['delay']
                                };
                            }

                            prevDelay = liveStops[liveIndex - 1]['arrival']['delay'];
                        }

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
                        // Add the previous stop to the update list to generate an updated connection with arrival delay
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

            return completedUpdates;
        } catch (err) {
            console.error(err);
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

    resolveURI(template, departureStop, arrivalStop, tripId, tripStartTime, connectionParams, resolve) {
        let varNames = template.varNames;
        let fillerObj = {};

        for (let i in varNames) {
            if(departureStop) {
                fillerObj[varNames[i]] = this.resolveValue(varNames[i], departureStop, tripId, tripStartTime, connectionParams, resolve || {});
            } else if(arrivalStop) {
                fillerObj[varNames[i]] = this.resolveValue(varNames[i], arrivalStop, tripId, tripStartTime, connectionParams, resolve || {});
            } else {
                fillerObj[varNames[i]] = this.resolveValue(varNames[i], null, tripId, tripStartTime, connectionParams, resolve || {});
            }
        }

        return template.fill(fillerObj);
    }

    resolveValue(param, stopId, tripId, tripStartTime, connection, resolve) {
        // Entity objects to be resolved as needed
        let trips = null;
        let routes = null;
        let stops = null;

        // try first to resolve using keys in 'resolve' object
        if (resolve[param]) {
            stops = stopId !== null ? this.stops.get(stopId) : null;
            trips = this.trips.get(tripId);
            trips['startTime'] = tripStartTime;
            routes = this.routes.get(trips['route_id']);

            return eval(resolve[param]);
        }

        // GTFS source file and attribute name
        let source = param.split('.')[0];
        let attr = param.split('.')[1];
        // Resolved value
        let value = null;

        switch (source) {
            case 'trips':
                trips = this.trips.get(tripId);
                if (attr.indexOf('startTime') >= 0) {
                    let dateFormat = attr.match(/\((.*?)\)/)[1];
                    value = format(tripStartTime, dateFormat);
                } else {
                    value = trips[attr];
                }
                break;
            case 'routes':
                trips = this.trips.get(tripId);
                routes = this.routes.get(trips['route_id']);
                value = routes[attr];
                break;
            case 'stops':
                stops = this.stops.get(stopId);
                value = stops[attr];
                break;
            case 'connection':
                if (attr.indexOf('departureTime') >= 0) {
                    let dateFormat = attr.match(/\((.*?)\)/)[1];
                    value = format(connection.departureTime, dateFormat);
                } else if (attr.indexOf('arrivalTime') >= 0) {
                    let dateFormat = attr.match(/\((.*?)\)/)[1];
                    value = format(connection.arrivalTime, dateFormat);
                } else {
                    value = connection[attr];
                }
                break;
        }

        return value;
    }

    resolveScheduleRelationship(value, scheduleType) {
        // SKIPPED
        if (value === 1) {
            return 'gtfs:NotAvailable';
        } else {
            if (!scheduleType || scheduleType == 0) {
                return 'gtfs:Regular';
            } else if (scheduleType == 1) {
                return 'gtfs:NotAvailable';
            } else if (scheduleType == 2) {
                return 'gtfs:MustPhone'
            } else if (scheduleType == 3) {
                return 'gtfs:MustCoordinateWithDriver';
            }
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

    get stop_times() {
        return this._stop_times;
    }

    get uris() {
        return this._uris;
    }
}

module.exports = Gtfsrt2LC;
