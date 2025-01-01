import { Transform } from 'stream';
import utpl from 'uri-templates';
import Utils from './Utils';
import { DataFactory } from "rdf-data-factory";

const df = new DataFactory();

export class Connections2Triples extends Transform {
    constructor(templates) {
        super({ objectMode: true });
        this._templates = templates;
    }

    _transform(conn, encoding, done) {
        // Predefined URI templates 
        const stopTemplate = utpl(this.templates['stop']);
        const routeTemplate = utpl(this.templates['route']);
        const tripTemplate = utpl(this.templates['trip']);
        const connectionTemplate = utpl(this.templates['connection']);

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
                df.quad(
                    df.namedNode(connectionURI),
                    df.namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
                    df.namedNode('http://semweb.mmlab.be/ns/linkedconnections#Connection')));
        } else {
            this.push(
                df.quad(
                    df.namedNode(connectionURI),
                    df.namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
                    df.namedNode('http://semweb.mmlab.be/ns/linkedconnections#CancelledConnection')));
        }

        this.push(
            df.quad(
                df.namedNode(connectionURI),
                df.namedNode('http://semweb.mmlab.be/ns/linkedconnections#departureStop'),
                df.namedNode(departureStopURI)));
        this.push(
            df.quad(
                df.namedNode(connectionURI),
                df.namedNode('http://semweb.mmlab.be/ns/linkedconnections#arrivalStop'),
                df.namedNode(arrivalStopURI)));
        this.push(
            df.quad(
                df.namedNode(connectionURI),
                df.namedNode('http://semweb.mmlab.be/ns/linkedconnections#departureTime'),
                df.literal(conn['departureTime'].toISOString(), df.namedNode('http://www.w3.org/2001/XMLSchema#dateTime'))));
        this.push(
            df.quad(
                df.namedNode(connectionURI),
                df.namedNode('http://semweb.mmlab.be/ns/linkedconnections#arrivalTime'),
                df.literal(conn['arrivalTime'].toISOString(), df.namedNode('http://www.w3.org/2001/XMLSchema#dateTime'))));
        this.push(
            df.quad(
                df.namedNode(connectionURI),
                df.namedNode('http://semweb.mmlab.be/ns/linkedconnections#departureDelay'),
                df.literal(conn['departureDelay'], df.namedNode('http://www.w3.org/2001/XMLSchema#integer'))));
        this.push(
            df.quad(
                df.namedNode(connectionURI),
                df.namedNode('http://semweb.mmlab.be/ns/linkedconnections#arrivalDelay'),
                df.literal(conn['arrivalDelay'], df.namedNode('http://www.w3.org/2001/XMLSchema#integer'))));
        this.push(
            df.quad(
                df.namedNode(connectionURI),
                df.namedNode('http://vocab.gtfs.org/terms#headsign'),
                df.literal(conn['headsign'], df.namedNode('http://www.w3.org/2001/XMLSchema#string'))));
        this.push(
            df.quad(
                df.namedNode(connectionURI),
                df.namedNode('http://vocab.gtfs.org/terms#trip'),
                df.namedNode(tripURI)));
        this.push(
            df.quad(
                df.namedNode(connectionURI),
                df.namedNode('http://vocab.gtfs.org/terms#route'),
                df.namedNode(routeURI)));
        this.push(
            df.quad(
                df.namedNode(connectionURI),
                df.namedNode('http://vocab.gtfs.org/terms#dropOffType'),
                df.namedNode(dropOffType)
            ));
        this.push(
            df.quad(
                df.namedNode(connectionURI),
                df.namedNode('http://vocab.gtfs.org/terms#pickupType'),
                df.namedNode(pickupType)
            ));

        done(null);
    }

    get templates() {
        return this._templates;
    }
}