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

const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

class Gtfsrt2LC {
    constructor(options) {
        this._path = options.path;
        this._uris = options.uris;
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
    }

    async getUpdatedTrips() {
        let trips = [];
        if (!this.jsonData) {
            await this.parse2Json(this.headers);
        }

        for (let i in this.jsonData.entity) {
            trips.push(this.jsonData.entity[i]['tripUpdate']['trip']['tripId']);
        }

        return trips;
    }

    async parse2Json() {
        let rawData = await this.getRawData(this.headers);
        let data = gtfsrt.FeedMessage.decode(rawData);
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
                    let startDate = tripUpdate.trip.startDate;
                    let serviceDay = new Date(startDate.substr(0, 4), parseInt(startDate.substr(4, 2)) - 1, startDate.substr(6, 2));
                    const timestamp = tripUpdate.timestamp || this.jsonData.header.timestamp;

                    // Check if tripId is directly provided or has to be found from GTFS source,
                    // as specified in https://gtfs.org/reference/realtime/v2/#message-tripdescriptor
                    if (!tripId && tripUpdate.trip.routeId) {
                        let deduced = await this.deduceTripId(tripUpdate.trip.routeId, tripUpdate.trip.startTime,
                            tripUpdate.trip.startDate, tripUpdate.trip.directionId);
                        tripId = deduced ? deduced['trip_id'] : null;
                        // Correct startTime by adding 24 hours (error noticed for HSL Helsinki GTFS-RT)
                        if (deduced && deduced['startTime']) {
                            tripUpdate.trip.startTime = deduced['startTime'];
                            this.correctTimes(tripUpdate);
                        }
                    }

                    let t = null;
                    let st = null;

                    try {
                        // Check if there is static data about the update, skip if not
                        t = await this.getTrip(tripId);
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

                    let tripStartTime = null;
                    if (tripUpdate.trip.startTime) {
                        tripStartTime = this.addDuration(serviceDay, this.parseGTFSDuration(tripUpdate.trip.startTime));
                    } else {
                        tripStartTime = this.addDuration(serviceDay, this.parseGTFSDuration((await this.getStopTimes(tripId))[0]['departure_time']));
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
                                     * GTFS-RT provides the delays from arriving and departing in a stop, we use the connection
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

                                    let raw_connection = {
                                        departureStop: await this.getStop(departureStop),
                                        departureTime: departureTime,
                                        arrivalStop: await this.getStop(arrivalStop),
                                        arrivalTime: arrivalTime
                                    };

                                    // Predefined URI templates 
                                    let stopTemplate = uri_templates(this.uris['stop']);
                                    let routeTemplate = uri_templates(this.uris['route']);
                                    let tripTemplate = uri_templates(this.uris['trip']);
                                    let connectionTemplate = uri_templates(this.uris['connection']);

                                    // Resolve values for URIs
                                    let departureStopURI = await this.resolveURI(stopTemplate, departureStop, null, tripId, tripStartTime, raw_connection, this.uris['resolve']);
                                    let arrivalStopURI = await this.resolveURI(stopTemplate, null, arrivalStop, tripId, tripStartTime, raw_connection, this.uris['resolve']);
                                    let routeURI = await this.resolveURI(routeTemplate, null, null, tripId, tripStartTime, raw_connection, this.uris['resolve']);
                                    let tripURI = await this.resolveURI(tripTemplate, null, null, tripId, tripStartTime, raw_connection, this.uris['resolve']);
                                    let connectionURI = await this.resolveURI(connectionTemplate, null, null, tripId, tripStartTime, raw_connection, this.uris['resolve']);
                                    // Determine Pick Up & Drop Off types
                                    let pickupType = this.resolveScheduleRelationship(cu['scheduleRelationship'], st[pdIndex]['pickup_type']);
                                    let dropOffType = this.resolveScheduleRelationship(completedUpdates[j + 1]['scheduleRelationship'], st[pdIndex + 1]['drop_off_type']);

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
                                        "direction": t['trip_headsign'],
                                        "trip": tripURI,
                                        "route": routeURI,
                                        "gtfs:pickupType": pickupType,
                                        "gtfs:dropOffType": dropOffType
                                    }

                                    readable.push(linked_connection);
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
                return readable.pipe(new Connections2JSONLD(true)).pipe(new jsonldstream.Serializer());
            } else {
                return readable.pipe(new Connections2JSONLD(true));
            }
        } else if (options.format === 'csv') {
            return readable.pipe(new Connections2CSV());
        } else if (options.format === 'ntriples') {
            return readable.pipe(new Connections2Triples()).pipe(new N3.StreamWriter({ format: 'N-Triples' }));
        } else if (options.format === 'turtle') {
            return readable.pipe(new Connections2Triples()).pipe(new N3.StreamWriter({
                prefixes: {
                    xsd: 'http://www.w3.org/2001/XMLSchema#',
                    lc: 'http://semweb.mmlab.be/ns/linkedconnections#',
                    gtfs: 'http://vocab.gtfs.org/terms#'
                }
            }));
        } else {
            if (!options.objectMode) {
                return readable.pipe(new jsonldstream.Serializer());
            } else {
                return readable;
            }
        }
    }

    getRawData(headers) {
        return new Promise((rsv, rjt) => {
            // Download/access static GTFS feed
            if (this.path.startsWith('http') || this.path.startsWith('https')) {
                let download_url = url.parse(this.path);
                if (!download_url) {
                    reject('Please provide a valid url or a path to a GTFS-RT feed');
                } else {
                    download_url.headers = headers;
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
        if (res.statusCode >= 400) {
            rjt(new Error('Request ' + res.responseUrl + ' failed with HTTP response code ' + res.statusCode));
        } else {
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
                    trips.push(JSON.parse(await this.trips.get(t)));
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
                const service = this.calendar.get(trips[i]['service_id']);
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

    correctTimes(tripUpdate) {
        for (let i = 0; i < tripUpdate.stopTimeUpdate.length; i++) {
            let dep = parseInt(tripUpdate.stopTimeUpdate[i].departure.time) + 86400;
            let arr = parseInt(tripUpdate.stopTimeUpdate[i].arrival.time) + 86400;
            tripUpdate.stopTimeUpdate[i].departure.time = dep;
            tripUpdate.stopTimeUpdate[i].arrival.time = arr;
        }
    }

    getConnectionType(entity) {
        let scheduleRelationship = entity.tripUpdate.trip.scheduleRelationship;
        // Look for CANCELED instead of CANCELLED because that is how gtfs-realtime-bindings has it (american english)
        if (entity.isDeleted || scheduleRelationship == 3 || scheduleRelationship === 'CANCELED') {
            return 'CancelledConnection'; // TODO: Add CancelledConnection class to LC vocabulary
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

            // Check if delays are present and explicitly add them if not by calculating
            // the difference between static and live times 
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
            }

            // If this stop is not the last of the trip and the stop update is missing departure info
            // add it manually taking into account the arrival delay at this stop
            if (staticIndex != staticLength - 1) {
                if (!update['departure']) {
                    update['departure'] = {
                        'delay': update['arrival']['delay'],
                        'time': (this.addDuration(serviceDay, this.parseGTFSDuration(staticData['departure_time'])).getTime() / 1000) + update['arrival']['delay']
                    }
                }
            }

            // If the stop update is missing arrival info and is not the first stop of the trip
            // add it manually taking into account the departure delay of the previous stop (if any)
            if (staticIndex != 0) {
                if (!update['arrival'] && prevUpdate) {
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
                }
            }

            // Check for consistencies between this update and the previous
            if (prevUpdate  && update['departure'] && prevUpdate['departure']['time'] > update['arrival']['time']) {
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
        }

        return update;
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

    async resolveURI(template, departureStop, arrivalStop, tripId, tripStartTime, connectionParams, resolve) {
        let varNames = template.varNames;
        let fillerObj = {};

        for (let v of varNames) {
            if (departureStop) {
                fillerObj[v] = await this.resolveValue(v, departureStop, tripId, tripStartTime, connectionParams, resolve || {});
            } else if (arrivalStop) {
                fillerObj[v] = await this.resolveValue(v, arrivalStop, tripId, tripStartTime, connectionParams, resolve || {});
            } else {
                fillerObj[v] = await this.resolveValue(v, null, tripId, tripStartTime, connectionParams, resolve || {});
            }
        }

        return template.fill(fillerObj);
    }

    async resolveValue(param, stopId, tripId, tripStartTime, connection, resolve) {
        // Entity objects to be resolved as needed
        let trips = tripId ? await this.getTrip(tripId) : null;
        let routes = tripId ? await this.getRoute(trips['route_id']) : null;
        let stops = stopId ? await this.getStop(stopId) : null;

        // try first to resolve using keys in 'resolve' object
        if (resolve[param]) {
            trips['startTime'] = tripStartTime;
            // Hotfix for route long names: usually contain --. However, we are 2019 at the time of writing and can use UTF-8!
            routes.route_long_name = routes.route_long_name.replace('--', '–');

            return eval(resolve[param]);
        }

        // GTFS source file and attribute name
        let source = param.split('.')[0];
        let attr = param.split('.')[1];
        // Resolved value
        let value = null;

        switch (source) {
            case 'trips':
                if (attr.indexOf('startTime') >= 0) {
                    let dateFormat = attr.match(/\((.*?)\)/)[1];
                    value = format(tripStartTime, dateFormat);
                } else {
                    value = trips[attr];
                }
                break;
            case 'routes':
                //Hotfix for route long names: usually contain --. However, we are 2019 at the time of writing and can use UTF-8!
                routes.route_long_name = routes.route_long_name.replace('--', '–');
                value = routes[attr];
                break;
            case 'stops':
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

    setIndexes(indexes) {
        this._routes = indexes.routes;
        this._trips = indexes.trips;
        this._stops = indexes.stops;
        this._stop_times = indexes.stop_times;
        this._tripsByRoute = indexes.tripsByRoute;
        this._firstStops = indexes.firstStops;
        this._calendar = indexes.calendar;
        this._calendarDates = indexes.calendarDates;
    }

    async getTrip(id) {
        if (this.trips instanceof Map) {
            return this.trips.get(id);
        } else {
            return JSON.parse(await this.trips.get(id));
        }
    }

    async getRoute(id) {
        if (this.routes instanceof Map) {
            return this.routes.get(id);
        } else {
            return JSON.parse(await this.routes.get(id));
        }
    }

    async getStop(id) {
        if (this.stops instanceof Map) {
            return this.stops.get(id);
        } else {
            return JSON.parse(await this.stops.get(id));
        }
    }

    async getStopTimes(id) {
        if (this.stop_times instanceof Map) {
            return this.stop_times.get(id);
        } else {
            return JSON.parse(await this.stop_times.get(id));
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
}

module.exports = Gtfsrt2LC;
