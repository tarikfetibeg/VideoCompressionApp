const fs = require('fs');

async function renameWithRetry(source, destination, { rename = fs.promises.rename, attempts = 8, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      if (!['EPERM', 'EBUSY'].includes(error.code) || attempt >= attempts - 1) throw error;
      // Windows scanners/readers may briefly retain a handle after encoding.
      await wait(100 * (attempt + 1));
    }
  }
}

module.exports = { renameWithRetry };
