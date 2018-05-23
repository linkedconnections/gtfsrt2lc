const { Transform } = require('stream');

class Connections2CSV extends Transform {
    constructor() {
        super({ objectMode: true });
        this._headerStreamed = false;
    }

    _transform(lc, encoding, done) {
        if (!this.headerStreamed) {
            this.headerStreamed = true;
            done(null, '"id","departureStop","departureTime","departureDelay",arrivalStop","arrivalTime","arrivalDelay","direction",trip","route"\n');
        } else {
            let csv = lc['@id'] + ',' + lc['departureStop'] + ',' + lc['departureTime'] + ',' + lc['departureDelay'] + ',' + lc['arrivalStop']
                + ',' + lc['arrivalTime'] + ',' + lc['arrivalDelay'] + ',' + lc['direction'] + ',' + lc['trip'] + ',' + lc['route'] + '\n';
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

module.exports = Connections2CSV;