const fs = require('fs');
const unzip = require('unzipper');

function unzipStream(stream, outPath) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(outPath)) {
            fs.mkdirSync(outPath);
        }
        stream.pipe(unzip.Extract({ path: outPath }))
            .on('error', async err => {
                await this.cleanUp();
                reject(err);
            })
            .on('close', () => {
                resolve();
            });
    });
}

module.exports = {
    unzipStream
}