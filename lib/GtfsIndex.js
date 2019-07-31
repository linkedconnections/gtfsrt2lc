const url = require('url');
const util = require('util');
const fs = require('fs');
const unzip = require('unzipper');
const csv = require('fast-csv');
const del = require('del');
const http = require('follow-redirects').http;
const https = require('follow-redirects').https;
const childProcess = require('child_process');

const exec = util.promisify(childProcess.exec);

class GtfsIndex {
    constructor(path, auxPath) {
        this._path = path;
        this._auxPath = auxPath || '.tmp';
    }

    getIndexes(trips, headers) {
        return new Promise(async (resolve, reject) => {
            try {
                await this.cleanUp();
                // Download/access static GTFS feed
                if (this.path.startsWith('http') || this.path.startsWith('https')) {
                    let download_url = url.parse(this.path);
                    if (!download_url) {
                        reject('Please provide a valid url or a path to a GTFS feed');
                        return;
                    } else {
                        download_url.headers = headers;
                        await this.doRequest(download_url);
                    }
                } else {
                    if (!fs.existsSync(this.path)) {
                        reject('Please provide a valid url or a path to a GTFS feed');
                        return;
                    } else {
                        await this.unzip(fs.createReadStream(this.path));
                    }
                }

                this.extractIndexes(trips, resolve, reject);
            } catch (err) {
                await this.cleanUp();
                reject(err);
            }
        });
    }

    doRequest(url) {
        return new Promise((resolve, reject) => {
            let req = null;
            if (url.protocol === 'https:') {
                req = https.request(url, async res => {
                    await this.unzip(res)
                    resolve();
                });
            } else {
                req = http.request(url, async res => {
                    await this.unzip(res)
                    resolve();
                });
            }
            req.on('error', err => {
                reject(err);
            });
            req.end();
        });
    }

    unzip(res) {
        return new Promise((resolve, reject) => {
            fs.mkdirSync(this.auxPath);
            res.pipe(unzip.Extract({ path: this.auxPath }))
                .on('error', async err => {
                    await this.cleanUp();
                    reject(err);
                })
                .on('close', () => {
                    resolve();
                });
        });
    }

    async extractIndexes(updateTrips, resolve, reject) {
        try {
            let stops_index = new Map();
            let routes_index = new Map();
            let trips_index = new Map();
            let stop_times_index = new Map();

            // Load all the stops and routes into memory
            let stops = this.createIndex(this.auxPath + '/stops.txt', stops_index, 'stop_id');
            let routes = this.createIndex(this.auxPath + '/routes.txt', routes_index, 'route_id');

            // Only load the necessary trips and stop_times
            let tripsHeaders = await this.getGtfsHeaders('trips.txt');
            let trips = Promise.all(updateTrips.map(async trip => {
                let t = await this.grepGtfsFile(trip, 'trips.txt', tripsHeaders);
                trips_index.set(trip, t[0]);
            }));

            let stopTimesHeaders = await this.getGtfsHeaders('stop_times.txt');
            let stop_times = Promise.all(updateTrips.map(async trip => {
                let stopTimes = await this.grepGtfsFile(trip, 'stop_times.txt', stopTimesHeaders);
                // Sort by stop_sequence to ensure an ordered stop list
                stopTimes.sort((a, b) => {
                    return parseInt(a['stop_sequence']) - parseInt(b['stop_sequence']);
                });
                stop_times_index.set(trip, stopTimes);
            }));

            await Promise.all([stops, routes, trips, stop_times]);
            await this.cleanUp();

            resolve({
                "routes": routes_index,
                "trips": trips_index,
                "stops": stops_index,
                "stop_times": stop_times_index
            });
        } catch (err) {
            reject(err);
        }
    }

    createIndex(path, map, key) {
        return new Promise((resolve, reject) => {
            fs.createReadStream(path, { encoding: 'utf8', objectMode: true })
                .pipe(csv.parse({ objectMode: true, headers: true }))
                .on('data', data => {
                    if (data[key]) {
                        map.set(data[key], data);
                    }
                })
                .on('error', async err => {
                    await this.cleanUp();
                    reject(err);
                })
                .on('finish', resolve);
        });
    }

    async getGtfsHeaders(fileName) {
        return (await exec('head -1 ' + fileName, { cwd: this.auxPath }))['stdout'].replace(/[\n\r"]/g, "").split(',');
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
        await del([this.auxPath], { force: true });
    }

    get path() {
        return this._path;
    }

    get auxPath() {
        return this._auxPath;
    }
}

module.exports = GtfsIndex;
