const { Transform } = require('stream');
const uri_templates = require('uri-templates');
const Utils = require('./Utils');

class Connections2JSONLD extends Transform {
    constructor(streamContext, templates) {
        super({ objectMode: true });
        this._streamContext = streamContext || false;
        this._contextStreamed = false;
        this._templates = templates;
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

    _transform(conn, encoding, done) {
        if (this._streamContext && !this.contextStreamed) {
            this.contextStreamed = true;
            this.push(this.context);
        }

        // Predefined URI templates 
        const stopTemplate = uri_templates(this.templates['stop']);
        const routeTemplate = uri_templates(this.templates['route']);
        const tripTemplate = uri_templates(this.templates['trip']);
        const connectionTemplate = uri_templates(this.templates['connection']);

        // Resolve values for URIs
        const departureStopURI = Utils.resolveURI(stopTemplate, conn, this.templates['resolve'], "departureStop");
        const arrivalStopURI = Utils.resolveURI(stopTemplate, conn, this.templates['resolve'], "arrivalStop");
        const routeURI = Utils.resolveURI(routeTemplate, conn, this.templates['resolve']);
        const tripURI = Utils.resolveURI(tripTemplate, conn, this.templates['resolve']);
        const connectionURI = Utils.resolveURI(connectionTemplate, conn, this.templates['resolve']);
        // Determine Pick Up & Drop Off types
        const pickupType = Utils.resolveScheduleRelationship(conn['pickup_type']);
        const dropOffType = Utils.resolveScheduleRelationship(conn['drop_off_type']);

        // Build LC
        const lc = {
            "@id": connectionURI,
            "@type": conn.type,
            "departureStop": departureStopURI,
            "arrivalStop": arrivalStopURI,
            "departureTime": conn.departureTime.toISOString(),
            "arrivalTime": conn.arrivalTime.toISOString(),
            "departureDelay": conn.departureDelay,
            "arrivalDelay": conn.arrivalDelay,
            "gtfs:trip": tripURI,
            "gtfs:route": routeURI,
            "direction": conn.trip['trip_headsign'],
            "gtfs:pickupType": pickupType,
            "gtfs:dropOffType": dropOffType
        }

        done(null, lc);
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

    get templates() {
        return this._templates;
    }
}

module.exports = Connections2JSONLD;
