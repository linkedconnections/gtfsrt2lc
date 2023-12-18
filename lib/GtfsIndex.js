const { URL } = require('url');
const { request } = require('undici');
const util = require('util');
const fs = require('fs');
const csv = require('fast-csv');
const del = require('del');
const childProcess = require('child_process');
const { Level } = require('level');
const Utils = require('./Utils');

const exec = util.promisify(childProcess.exec);

class GtfsIndex {
    constructor(options) {
        this._path = options.path;
        this._auxPath = options.auxPath || '.tmp';
        this._headers = options.headers || {};
    }

    async getIndexes(options) {
        try {
            await this.cleanUp();
            // Download or load from disk static GTFS feed
            if (this.path.startsWith('http') || this.path.startsWith('https')) {
                const downloadURL = new URL(this.path);
                if (!downloadURL.protocol) {
                    throw new Error('Please provide a valid URL or a path to a GTFS feed');
                } else {
                    await this.download(this.path, this.headers);
                }
            } else {
                if (!fs.existsSync(this.path)) {
                    throw new Error('Please provide a valid url or a path to a GTFS feed');
                } else {
                    if (this.path.endsWith('.zip')) {
                        Utils.unzip(this.path, this.auxPath);
                    } else {
                        this.auxPath = this.path;
                    }
                }
            }

            return this.createIndexes(options.store, options.trips, options.deduce);
        } catch (err) {
            await this.cleanUp();
            throw err;
        }
    }

    download(url, headers) {
        return new Promise(async (resolve, reject) => {
            try {
                const res = await request(url, {
                    method: 'GET',
                    headers,
                    maxRedirections: 10
                });

                if (res.statusCode === 200) {
                    res.body.pipe(createWriteStream("/tmp/gtfs.zip"))
                        .on("finish", () => {
                            Utils.unzip("/tmp/gtfs.zip", this.auxPath);
                            resolve();
                        });
                } else {
                    reject(new Error(`Error on HTTP request: ${url}, Message: ${await res.body.text()}`));
                }
            } catch (err) {
                await this.cleanUp();
                reject(err);
            }
        });
    }

    async createIndexes(store, uTrips, deduce) {
        let stops_index = null;
        let routes_index = null;
        let trips_index = null;
        let stop_times_index = null;
        let tripsByRoute = null;
        let firstStops = null;
        let calendar_index = null;
        let calendarDates = null;
        let tp = null;
        let stp = null;
        let cp = null;
        let cdp = null;


        if (deduce) {
            tripsByRoute = new Map();
            firstStops = new Map();
            calendarDates = new Map();
        }

        // CSV headers of stop_times.txt. Needed for grep and sort processes.
        let stopTimesHeaders = await this.getGtfsHeaders('stop_times.txt');

        if (store === 'MemStore') {
            stops_index = new Map();
            routes_index = new Map();
            trips_index = new Map();
            stop_times_index = new Map();
            calendar_index = new Map();


            if (uTrips) {
                console.error(`Using grep to extract the stop_times of ${uTrips.length} trips`);
                // Only load the necessary trips and stop_times
                let tripsHeaders = await this.getGtfsHeaders('trips.txt');
                tp = Promise.all(uTrips.map(async trip => {
                    let t = await this.grepGtfsFile(trip, 'trips.txt', tripsHeaders);
                    trips_index.set(trip, t[0]);
                }));

                // Grep the stop_times of only the trips present in the GTFS-RT update
                stp = this.grepStopTimes(uTrips, stopTimesHeaders, stop_times_index);

            } else {
                tp = this.createIndex(this.auxPath + '/trips.txt', trips_index, 'trip_id', tripsByRoute);
                // Make sure stop_times.txt is ordered by stop_sequence
                let ti_index = stopTimesHeaders.indexOf('trip_id') + 1;
                let ss_index = stopTimesHeaders.indexOf('stop_sequence') + 1;
                await this.sortStopTimes(ti_index, ss_index);
                // Create index of stop times for every trip
                stp = this.processStopTimes(this.auxPath + '/stop_times.txt', stop_times_index, firstStops);
            }
        } else if (store === 'LevelStore') {
            await del(['.rt_indexes'], { force: true });
            fs.mkdirSync('.rt_indexes');

            stops_index = new Level('.rt_indexes/.stops', { valueEncoding: 'json' });
            routes_index = new Level('.rt_indexes/.routes', { valueEncoding: 'json' });
            trips_index = new Level('.rt_indexes/.trips', { valueEncoding: 'json' });
            stop_times_index = new Level('.rt_indexes/.stop_times', { valueEncoding: 'json' });
            calendar_index = new Level('.rt_indexes/.calendar', { valueEncoding: 'json' });

            tp = this.createIndex(this.auxPath + '/trips.txt', trips_index, 'trip_id', tripsByRoute);
            // Make sure stop_times.txt is ordered by stop_sequence
            let ti_index = stopTimesHeaders.indexOf('trip_id') + 1;
            let ss_index = stopTimesHeaders.indexOf('stop_sequence') + 1;
            await this.sortStopTimes(ti_index, ss_index);
            stp = this.processStopTimes(this.auxPath + '/stop_times.txt', stop_times_index, firstStops);
        } else {
            throw new Error(`Unrecognized store format: ${store}`);
        }

        let sp = this.createIndex(this.auxPath + '/stops.txt', stops_index, 'stop_id');
        let rp = this.createIndex(this.auxPath + '/routes.txt', routes_index, 'route_id');
        cp = this.createIndex(this.auxPath + '/calendar.txt', calendar_index, 'service_id');

        if (deduce) {
            cdp = this.processCalendarDates(this.auxPath + '/calendar_dates.txt', calendarDates);
        }

        await Promise.all([sp, rp, tp, stp, cp, cdp]);
        await this.cleanUp();

        return {
            "routes": routes_index,
            "trips": trips_index,
            "stops": stops_index,
            "stop_times": stop_times_index,
            "calendar": calendar_index,
            "tripsByRoute": tripsByRoute,
            "firstStops": firstStops,
            "calendarDates": calendarDates
        };
    }

    async createIndex(path, map, key, tpr) {
        if (fs.existsSync(path)) {
            let stream = fs.createReadStream(path, { encoding: 'utf8', objectMode: true })
                .pipe(csv.parse({ objectMode: true, headers: true }))
                .on('error', err => { throw err; });

            for await (const data of stream) {
                if (data[key]) {
                    if (map instanceof Map) {
                        map.set(data[key], data);
                    } else {
                        await map.put(data[key], data, { valueEncoding: 'json' });
                    }

                    // Get an index of trips grouped by route
                    if (tpr && path.endsWith('trips.txt')) {
                        let ts = await tpr.get(data['route_id']);
                        if (!ts) {
                            tpr.set(data['route_id'], [data['trip_id']]);
                        } else {
                            ts.push(data['trip_id']);
                            tpr.set(data['route_id'], ts);
                        }
                    }
                }
            }
        }
    }

    async getGtfsHeaders(fileName) {
        return (await exec('head -1 ' + fileName, { cwd: this.auxPath }))['stdout'].replace(/[\n\r"]/g, "").split(',').map(h => h.trim());
    }

    async sortStopTimes(ti_index, ss_index) {
        return exec('{ head -n 1 stop_times.txt ; tail -n +2 stop_times.txt | sort -t , -k '
            + ti_index + 'd,' + ti_index + ' -k' + ss_index + 'n,' + ss_index + '; } '
            + '> stop_times_sorted.txt ; mv stop_times_sorted.txt stop_times.txt ;', { cwd: this.auxPath });
    }

    async processStopTimes(path, map, fst) {
        let currentTripId = null;
        let currentTrip = [];

        let stream = fs.createReadStream(path, { encoding: 'utf8', objectMode: true })
            .pipe(csv.parse({ objectMode: true, headers: true }))
            .on('error', err => { throw err });

        for await (const data of stream) {
            if (data['trip_id']) {
                if (fst && data['stop_sequence'] === '1') {
                    fst.set(data['trip_id'], data);
                }
                if (currentTripId === null || data['trip_id'] === currentTripId) {
                    currentTrip.push(data);
                } else {
                    // Add to the index
                    if (map instanceof Map) {
                        map.set(currentTripId, currentTrip);
                    } else {
                        await map.put(currentTripId, currentTrip);
                    }
                    // Prepare for next trip
                    currentTrip = [];
                    currentTrip.push(data);
                }

                // Keep track of the current trip
                currentTripId = data['trip_id'];
            }
        }
        // Add last scanned trip to the index
        if (map instanceof Map) {
            map.set(currentTripId, currentTrip);
        } else {
            await map.put(currentTripId, currentTrip, { valueEncoding: 'json' });
        }
    }

    async processCalendarDates(path, map) {
        let stream = fs.createReadStream(path, { encoding: 'utf8', objectMode: true })
            .pipe(csv.parse({ objectMode: true, headers: true }))
            .on('error', err => { throw err });

        for await (const data of stream) {
            let s = map.get(data['service_id']);
            if (!s) {
                s = {};
            }
            s[data['date']] = data['exception_type'];
            map.set(data['service_id'], s);
        }
    }

    grepStopTimes(trips, stopTimesHeaders, stop_times_index) {
        return Promise.all(trips.map(async trip => {
            let stopTimes = await this.grepGtfsFile(trip, 'stop_times.txt', stopTimesHeaders);
            // Sort by stop_sequence to ensure an ordered stop list
            stopTimes.sort((a, b) => {
                return parseInt(a['stop_sequence']) - parseInt(b['stop_sequence']);
            });
            stop_times_index.set(trip, stopTimes);
        }));
    }

    grepGtfsFile(tripId, fileName, headers) {
        return new Promise((resolve, reject) => {
            let buffer = '';
            let grep = childProcess.spawn('grep', [tripId, fileName], { cwd: this.auxPath });

            grep.stdout.on('data', data => {
                buffer += data.toString();
            });

            grep.stderr.on('data', (data) => {
                console.error(`stderr: ${data}`);
                reject();
            });

            grep.on('close', () => {
                let result = [];
                let dataArray = buffer.split('\n');
                // Get rid of the last empty string
                dataArray.pop();

                for (let i in dataArray) {
                    let obj = {};
                    let d = dataArray[i].replace(/[\n\r"]/g, "").split(',');
                    for (let j in headers) {
                        obj[headers[j]] = d[j];
                    }
                    result.push(obj);
                }

                resolve(result);
            });
        });
    }

    async cleanUp() {
        // We don't want to delete sources that are probably been reused
        if (this.auxPath !== this.path) {
            await del([this.auxPath, "/tmp/gtfs.zip"], { force: true });
        }
    }

    get path() {
        return this._path;
    }

    get auxPath() {
        return this._auxPath;
    }

    set auxPath(path) {
        this._auxPath = path;
    }

    get headers() {
        return this._headers;
    }
}

module.exports = GtfsIndex;
