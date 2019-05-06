const { Readable } = require('stream');
const url = require('url');
const http = require('follow-redirects').http;
const https = require('follow-redirects').https;
const fs = require('fs');
const zlib = require('zlib');
const gtfsrt = require('gtfs-realtime-bindings');
const uri_templates = require('uri-templates');
const jsonldstream = require('jsonld-stream');
const N3 = require('n3');
const { format, addHours, addMinutes, addSeconds } = require('date-fns');
const Connections2JSONLD = require('./Connections2JSONLD');
const Connections2CSV = require('./Connections2CSV');
const Connections2Triples = require('./Connections2Triples');

class Gtfsrt2LC {
    constructor(path, routes, trips, uris) {
        this._path = path;
        this._routes = routes;
        this._trips = trips;
        this._uris = uris;
    }

    async parse(format, object) {
        const readable = new Readable({
            objectMode: true,
            read() { }
        });

        try {
            let rawData = await this.getRawData();
            let feed = gtfsrt.FeedMessage.decode(rawData);
            //fs.writeFileSync('/home/julian/Desktop/test.json', JSON.stringify(feed), 'utf8');

            Promise.all(feed.entity.map(async entity => {
                if (entity.trip_update) {
                    let trip_update = entity.trip_update;
                    let trip_id = trip_update.trip.trip_id;
                    let start_date = trip_update.trip.start_date;
                    let serviceDay = new Date(start_date.substr(0, 4), parseInt(start_date.substr(4, 2)) - 1, start_date.substr(6, 2));
                    let tripStartTime = this.addDuration(serviceDay, this.parseGTFSDuration(trip_update.trip.start_time));

                    // Check if there is static data about the update, skip if not
                    if (!this.trips.get(trip_id)) {
                        console.error('Trip id ' + trip_id + ' not found in current GTFS static data');
                        return;
                    }

                    // Check if train is canceled or not
                    let type = this.getConnectionType(entity);

                    // for each stop time update
                    let stop_times = trip_update.stop_time_update;
                    let st_length = stop_times.length;

                    for (let j = 0; j < st_length; j++) {
                        try {
                            if (j + 1 < st_length) {
                                // Basic attributes of a Connection
                                let departureStop = stop_times[j].stop_id.split(':')[0];
                                let arrivalStop = trip_update.stop_time_update[j + 1].stop_id.split(':')[0];
                                let departureTime = null;
                                let arrivalTime = null;
                                let departureDelay = 0;
                                let arrivalDelay = 0;

                                // depertureDelay value
                                if (stop_times[j].departure && stop_times[j].departure.delay) {
                                    departureDelay = stop_times[j].departure.delay;
                                }

                                // Calculate departureTime including delay
                                if (stop_times[j].departure && stop_times[j].departure.time && stop_times[j].departure.time.low) {
                                    departureTime = new Date(stop_times[j].departure.time.low * 1000);
                                }

                                // arrivalDelay value
                                if (stop_times[j + 1].arrival && stop_times[j + 1].arrival.delay) {
                                    arrivalDelay = stop_times[j + 1].arrival.delay;
                                }

                                // Calculate arrivalTime including delay
                                if (stop_times[j + 1].arrival && stop_times[j + 1].arrival.time && stop_times[j + 1].arrival.time.low) {
                                    // If arrivalDelay is 0 make it equals to departureDelay to prevent departureTime become greater than arrivalTime
                                    if (arrivalDelay === 0 && departureDelay > 0) {
                                        arrivalTime = new Date((stop_times[j + 1].arrival.time.low * 1000) + (departureDelay * 1000));
                                        arrivalDelay = departureDelay;
                                    } else {
                                        arrivalTime = new Date(stop_times[j + 1].arrival.time.low * 1000);
                                    }
                                }

                                let raw_connection = {
                                    departureStop: departureStop,
                                    departureTime: departureTime,
                                    arrivalStop: arrivalStop,
                                    arrivalTime: arrivalTime
                                };

                                //Predefined URI templates 
                                let stopTemplate = uri_templates(this.uris['stop']);
                                let routeTemplate = uri_templates(this.uris['route']);
                                let tripTemplate = uri_templates(this.uris['trip']);
                                let connectionTemplate = uri_templates(this.uris['connection']);

                                // Resolve values for URIs
                                let departureStopURI = stopTemplate.fill({ [stopTemplate.varNames[0]]: departureStop });
                                let arrivalStopURI = stopTemplate.fill({ [stopTemplate.varNames[0]]: arrivalStop });
                                let routeURI = this.resolveURI(routeTemplate, trip_id, tripStartTime, raw_connection);
                                let tripURI = this.resolveURI(tripTemplate, trip_id, tripStartTime, raw_connection);
                                let connectionURI = this.resolveURI(connectionTemplate, trip_id, tripStartTime, raw_connection);
                                let pickupType = this.resolveScheduleRelationship(stop_times[j].schedule_relationship);
                                let dropOffType = this.resolveScheduleRelationship(stop_times[j + 1].schedule_relationship);

                                let linked_connection = {
                                    "@id": connectionURI,
                                    "@type": type,
                                    "departureStop": departureStopURI,
                                    "arrivalStop": arrivalStopURI,
                                    "departureTime": departureTime.toISOString(),
                                    "arrivalTime": arrivalTime.toISOString(),
                                    "departureDelay": departureDelay,
                                    "arrivalDelay": arrivalDelay,
                                    "direction": this.trips.get(trip_id).trip_headsign,
                                    "trip": tripURI,
                                    "route": routeURI,
                                    "gtfs:pickupType": pickupType,
                                    "gtfs:dropOffType": dropOffType
                                }

                                readable.push(linked_connection);
                            }
                        } catch (err) {
                            console.error('Null value found in stop times sequence for Trip ' + trip_id);
                            continue;
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
            if (!object) {
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
            if (!object) {
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
        if (entity.is_deleted || entity.trip_update.trip.schedule_relationship == 3) {
            return 'CanceledConnection';
        }
        else {
            return 'Connection';
        }
    }

    addDuration(date, duration) {
        return addSeconds(addMinutes(addHours(date, duration.hours), duration.minutes), duration.seconds);
    }

    parseGTFSDuration(durationString) {
        let [hours, minutes, seconds] = durationString.split(':').map((val) => { return parseInt(val); });
        //Be forgiving to durations that do not follow the spec e.g., (12:00 instead of 12:00:00)
        return { hours, minutes, seconds: seconds ? seconds : 0 };
    }

    resolveURI(template, tripId, tripStartTime, connectionParams) {
        let varNames = template.varNames;
        let fillerObj = {};

        for (let i in varNames) {
            fillerObj[varNames[i]] = this.resolveValue(varNames[i], tripId, tripStartTime, connectionParams);
        }

        return template.fill(fillerObj);
    }

    resolveValue(param, tripId, tripStartTime, connParams) {
        // GTFS source file and attribute name
        let source = param.split('.')[0];
        let attr = param.split('.')[1];

        // Entity objects to be resolved as needed
        let trip = null;
        let route = null;
        let caldate = null;

        let value = null;

        switch (source) {
            case 'trips':
                trip = this.trips.get(tripId);
                if(attr.indexOf('startTime') >= 0) {
                    let dateFormat = attr.match(/\((.*?)\)/)[1];
                    value = format(tripStartTime, dateFormat);
                } else {
                    value = trip[attr];
                }
                break;
            case 'routes':
                trip = this.trips.get(tripId);
                route = this.routes.get(trip.route_id);
                value = route[attr];
                break;
            case 'connection':
                if (attr.indexOf('departureTime') >= 0) {
                    let dateFormat = attr.match(/\((.*?)\)/)[1];
                    value = format(connParams.departureTime, dateFormat);
                } else if (attr.indexOf('arrivalTime') >= 0) {
                    let dateFormat = attr.match(/\((.*?)\)/)[1];
                    value = format(connParams.arrivalTime, dateFormat);
                } else {
                    value = connParams[attr];
                }
                break;
        }

        return value;
    }

    resolveScheduleRelationship(value) {
        // SCHEDULED
        if(value == 0) {
            return 'gtfs:Regular';
        }
        // SKIPPED
        else if(value == 1) {
            return 'gtfs:NotAvailable';
        }
        // NO_DATA
        return null;
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

    get uris() {
        return this._uris;
    }
}

module.exports = Gtfsrt2LC;
