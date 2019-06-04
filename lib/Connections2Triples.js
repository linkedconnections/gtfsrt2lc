const { Transform } = require('stream');
const N3 = require('n3');
const { DataFactory } = N3;
const { namedNode, literal, quad } = DataFactory;

class Connections2Triples extends Transform {
    constructor() {
        super({ objectMode: true });
    }

    _transform(lc, encoding, done) {
        if (lc['@type'] === 'Connection') {
            this.push(
                quad(
                    namedNode(lc['@id']),
                    namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
                    namedNode('http://semweb.mmlab.be/ns/linkedconnections#Connection')));
        } else {
            this.push(
                quad(
                    namedNode(lc['@id']),
                    namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
                    namedNode('http://semweb.mmlab.be/ns/linkedconnections#CancelledConnection')));
        }
        
        this.push(
            quad(
                namedNode(lc['@id']),
                namedNode('http://semweb.mmlab.be/ns/linkedconnections#departureStop'),
                namedNode(lc['departureStop'])));
        this.push(
            quad(
                namedNode(lc['@id']),
                namedNode('http://semweb.mmlab.be/ns/linkedconnections#arrivalStop'),
                namedNode(lc['arrivalStop'])));
        this.push(
            quad(
                namedNode(lc['@id']),
                namedNode('http://semweb.mmlab.be/ns/linkedconnections#departureTime'),
                literal(lc['departureTime'], namedNode('http://www.w3.org/2001/XMLSchema#dateTime'))));
        this.push(
            quad(
                namedNode(lc['@id']),
                namedNode('http://semweb.mmlab.be/ns/linkedconnections#arrivalTime'),
                literal(lc['arrivalTime'], namedNode('http://www.w3.org/2001/XMLSchema#dateTime'))));
        this.push(
            quad(
                namedNode(lc['@id']),
                namedNode('http://semweb.mmlab.be/ns/linkedconnections#departureDelay'),
                literal(lc['departureDelay'], namedNode('http://www.w3.org/2001/XMLSchema#integer'))));
        this.push(
            quad(
                namedNode(lc['@id']),
                namedNode('http://semweb.mmlab.be/ns/linkedconnections#arrivalDelay'),
                literal(lc['arrivalDelay'], namedNode('http://www.w3.org/2001/XMLSchema#integer'))));
        this.push(
            quad(
                namedNode(lc['@id']),
                namedNode('http://vocab.gtfs.org/terms#headsign'),
                literal(lc['direction'], namedNode('http://www.w3.org/2001/XMLSchema#string'))));
        this.push(
            quad(
                namedNode(lc['@id']),
                namedNode('http://vocab.gtfs.org/terms#trip'),
                namedNode(lc['trip'])));
        this.push(
            quad(
                namedNode(lc['@id']),
                namedNode('http://vocab.gtfs.org/terms#route'),
                namedNode(lc['route'])));

        done(null);
    }
}

module.exports = Connections2Triples;