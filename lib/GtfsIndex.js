const url = require('url');
const fs = require('fs');
const unzip = require('unzipper');
const csv = require('fast-csv');
const through2 = require('through2');
const del = require('del');
const http = require('follow-redirects').http;
const https = require('follow-redirects').https;

class GtfsIndex {
    constructor(path) {
        this._path = path;
    }

    getIndexes() {
        return new Promise(async (resolve, reject) => {
            await this.cleanUp();
            // Download/access static GTFS feed
            if (this.path.startsWith('http') || this.path.startsWith('https')) {
                let download_url = url.parse(this.path);
                if (!download_url) {
                    reject('Please provide a valid url or a path to a GTFS feed');
                } else {
                    if (download_url.protocol === 'https:') {
                        let req = https.request(download_url, res => this.handleResponse(res, resolve, reject));
                        req.on('error', err => {
                            reject(err);
                        });
                        req.end();
                    } else {
                        let req = http.request(download_url, res => this.handleResponse(res, resolve, reject));
                        req.on('error', err => {
                            reject(err);
                        });
                        req.end();
                    }
                }
            } else {
                if (!fs.existsSync(this.path)) {
                    reject('Please provide a valid url or a path to a GTFS feed');
                } else {
                    fs.mkdirSync('.tmp');
                    fs.createReadStream(this.path).pipe(unzip.Extract({ path: '.tmp' }))
                        .on('error', async err => {
                            await this.cleanUp();
                            reject(err);
                        })
                        .on('close', () => {
                            this.extractIndexes(resolve, reject);
                        });
                }
            }
        });
    }

    handleResponse(res, resolve, reject) {
        fs.mkdirSync('.tmp');
        res.pipe(unzip.Extract({ path: '.tmp' }))
            .on('error', async err => {
                await this.cleanUp();
                reject(err);
            })
            .on('close', () => {
                this.extractIndexes(resolve, reject);
            });
    }

    extractIndexes(resolve, reject) {
        let routes_index = new Map();
        let trips_index = new Map();
        let stop_times_index = new Map();

        // Parse the GTFS files using fast-csv lib
        let routes = fs.createReadStream('.tmp/routes.txt', { encoding: 'utf8', objectMode: true })
            .on('error', async err => {
                await this.cleanUp();
                reject(err);
            })
            .pipe(csv({ objectMode: true, headers: true }));
        let trips = fs.createReadStream('.tmp/trips.txt', { encoding: 'utf8', objectMode: true })
            .on('error', async err => {
                await this.cleanUp();
                reject(err);
            })
            .pipe(csv({ objectMode: true, headers: true }));
        
        let stop_times = fs.createReadStream('.tmp/stop_times.txt', { encoding: 'utf8', objectMode: true })
            .on('error', async err => {
                await this.cleanUp();
                reject(err);
            })
            .pipe(csv({ objectMode: true, headers: true }));
        
        // Use through2 transform stream to store every id in the correspondent index
        routes.pipe(through2.obj((route, enc, done) => {
            if (route['route_id']) {
                routes_index.set(route['route_id'], route);
            }
            done();
        }))
            .on('error', async err => {
                await this.cleanUp();
                reject(err);
            })
            .on('finish', () => {
                finish();
            });

        trips.pipe(through2.obj(async (trip, enc, done) => {
            if (trip['trip_id']) {
                trips_index.set(trip['trip_id'], trip);
            }
            done();
        }))
            .on('error', async err => {
                await this.cleanUp();
                reject(e);
            })
            .on('finish', () => {
                finish();
            });
        
        stop_times.pipe(through2.obj(async (stop_time, enc, done) => {
            if (stop_time['trip_id']) {
                let entries = [];
                if(stop_times_index.has(stop_time['trip_id'])) {
                    entries = stop_times_index.get(stop_time['trip_id'])
                    entries.push(stop_time);
                }
                else {
                    entries.push(stop_time);
                }
                stop_times_index.set(stop_time['trip_id'], entries);
            }
            done();
        }))
            .on('error', async err => {
                await this.cleanUp();
                reject(e);
            })
            .on('finish', () => {
                finish();
            });

        let count = 0;
        // Function to sync streams
        let finish = async () => {
            count++;
            if (count === 3) {
                // Delete temporal dir with unziped GTFS files
                await this.cleanUp();
                resolve([routes_index, trips_index, stop_times_index]);
            }
        };
    }

    async cleanUp() {
        await del(['.tmp'], { force: true });
    }

    get path() {
        return this._path;
    }
}

module.exports = GtfsIndex;
