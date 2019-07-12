const { Transform } = require('stream');
const N3 = require('n3');
const { DataFactory } = N3;
const { namedNode, literal, quad } = DataFactory;

class Connections2JSONLD extends Transform {
    constructor(streamContext) {
        super({ objectMode: true });
        this._streamContext = streamContext || false;
        this._contextStreamed = false;
        this._context = {
            "@context": {
                "xsd": "http://www.w3.org/2001/XMLSchema#",
                "lc": "http://semweb.mmlab.be/ns/linkedconnections#",
                "gtfs": "http://vocab.gtfs.org/terms#",
                "Connection": "lc:Connection",
                "CancelledConnection": "lc:CancelledConnection",
                "departureStop": {
                    "@type": "@id",
                    "@id": "lc:departureStop"
                },
                "arrivalStop": {
                    "@type": "@id",
                    "@id": "lc:arrivalStop"
                },
                "departureTime": {
                    "@id": "lc:departureTime",
                    "@type": "xsd:dateTime"
                },
                "arrivalTime": {
                    "@id": "lc:arrivalTime",
                    "@type": "xsd:dateTime"
                },
                "departureDelay": {
                    "@id": "lc:departureDelay",
                    "@type": "xsd:integer"
                },
                "arrivalDelay": {
                    "@id": "lc:arrivalDelay",
                    "@type": "xsd:integer"
                },
                "direction": {
                    "@id": "gtfs:headsign",
                    "@type": "xsd:string"
                },
                "gtfs:trip": {
                    "@type": "@id"
                },
                "gtfs:route": {
                    "@type": "@id"
                },
            }
        }
    }

    _transform(lc, encoding, done) {
        if (this._streamContext && !this.contextStreamed) {
            this.contextStreamed = true;
            this.push(this.context);
        }

        let temp = {
            "@id": lc['@id'],
            "@type": lc['@type'],
            "departureStop": lc['departureStop'],
            "arrivalStop": lc['arrivalStop'],
            "departureTime": lc['departureTime'],
            "arrivalTime": lc['arrivalTime'],
            "departureDelay": lc['departureDelay'],
            "arrivalDelay": lc['arrivalDelay'],
            "direction": lc['direction'],
            "gtfs:trip": lc['trip'],
            "gtfs:route": lc['route'],
            "gtfs:pickupType": lc['gtfs:pickupType'],
            "gtfs:dropOffType": lc['gtfs:dropOffType']
        }

        done(null, temp);
    }

    get contextStreamed() {
        return this._contextStreamed;
    }

    set contextStreamed(val) {
        this._contextStreamed = val;
    }

    get context() {
        return this._context;
    }
}

module.exports = Connections2JSONLD;
