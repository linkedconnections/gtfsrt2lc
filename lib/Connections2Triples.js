const { Transform } = require('stream');
const N3 = require('n3');
const { DataFactory } = N3;
const { namedNode, literal, quad } = DataFactory;
const uri_templates = require('uri-templates');
const Utils = require('./Utils');

class Connections2Triples extends Transform {
    constructor(templates) {
        super({ objectMode: true });
        this._templates = templates;
    }

    _transform(conn, encoding, done) {
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

        if (conn['type'] === 'Connection') {
            this.push(
                quad(
                    namedNode(connectionURI),
                    namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
                    namedNode('http://semweb.mmlab.be/ns/linkedconnections#Connection')));
        } else {
            this.push(
                quad(
                    namedNode(connectionURI),
                    namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
                    namedNode('http://semweb.mmlab.be/ns/linkedconnections#CancelledConnection')));
        }

        this.push(
            quad(
                namedNode(connectionURI),
                namedNode('http://semweb.mmlab.be/ns/linkedconnections#departureStop'),
                namedNode(departureStopURI)));
        this.push(
            quad(
                namedNode(connectionURI),
                namedNode('http://semweb.mmlab.be/ns/linkedconnections#arrivalStop'),
                namedNode(arrivalStopURI)));
        this.push(
            quad(
                namedNode(connectionURI),
                namedNode('http://semweb.mmlab.be/ns/linkedconnections#departureTime'),
                literal(conn['departureTime'].toISOString(), namedNode('http://www.w3.org/2001/XMLSchema#dateTime'))));
        this.push(
            quad(
                namedNode(connectionURI),
                namedNode('http://semweb.mmlab.be/ns/linkedconnections#arrivalTime'),
                literal(conn['arrivalTime'].toISOString(), namedNode('http://www.w3.org/2001/XMLSchema#dateTime'))));
        this.push(
            quad(
                namedNode(connectionURI),
                namedNode('http://semweb.mmlab.be/ns/linkedconnections#departureDelay'),
                literal(conn['departureDelay'], namedNode('http://www.w3.org/2001/XMLSchema#integer'))));
        this.push(
            quad(
                namedNode(connectionURI),
                namedNode('http://semweb.mmlab.be/ns/linkedconnections#arrivalDelay'),
                literal(conn['arrivalDelay'], namedNode('http://www.w3.org/2001/XMLSchema#integer'))));
        this.push(
            quad(
                namedNode(connectionURI),
                namedNode('http://vocab.gtfs.org/terms#headsign'),
                literal(conn['headsign'], namedNode('http://www.w3.org/2001/XMLSchema#string'))));
        this.push(
            quad(
                namedNode(connectionURI),
                namedNode('http://vocab.gtfs.org/terms#trip'),
                namedNode(tripURI)));
        this.push(
            quad(
                namedNode(connectionURI),
                namedNode('http://vocab.gtfs.org/terms#route'),
                namedNode(routeURI)));
        this.push(
            quad(
                namedNode(connectionURI),
                namedNode('http://vocab.gtfs.org/terms#dropOffType'),
                namedNode(dropOffType)
            ));
        this.push(
            quad(
                namedNode(connectionURI),
                namedNode('http://vocab.gtfs.org/terms#pickupType'),
                namedNode(pickupType)
            ));

        done(null);
    }

    get templates() {
        return this._templates;
    }
}

module.exports = Connections2Triples;