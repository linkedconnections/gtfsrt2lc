import { Transform } from 'stream';

export class Connections2CSV extends Transform {
    constructor() {
        super({ objectMode: true });
        this._headerStreamed = false;
    }

    _transform(conn, encoding, done) {
        if (!this.headerStreamed) {
            this.headerStreamed = true;
            done(null, '"type",departureStop","departureTime","departureDelay",arrivalStop","arrivalTime","arrivalDelay","headsign",trip","route"\n');
        } else {
            const csv = conn['type'] + ',' + conn['departureStop']['stop_name'] + ',' 
                + conn['departureTime'].toISOString() + ',' + conn['departureDelay'] + ',' + conn['arrivalStop']['stop_name'] + ',' 
                + conn['arrivalTime'].toISOString() + ',' + conn['arrivalDelay'] + ',' + conn['headsign'] + ',' 
                + conn['trip']['trip_id'] + ',' + conn['route']['route_long_name'] + '\n';
            done(null, csv);
        }
    }

    get headerStreamed() {
        return this._headerStreamed;
    }

    set headerStreamed(value) {
        this._headerStreamed = value;
    }
}