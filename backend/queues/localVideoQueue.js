const EventEmitter = require('events');

class LocalJob {
  constructor(id, data) {
    this.id = id;
    this.data = data;
    this.progressValue = 0;
  }

  async progress(value) {
    this.progressValue = value;
  }
}

class LocalVideoQueue extends EventEmitter {
  constructor() {
    super();
    this.jobs = [];
    this.activeCount = 0;
    this.concurrency = 1;
    this.handler = null;
    this.jobCounter = 0;
  }

  async add(data) {
    this.jobCounter += 1;
    const job = new LocalJob(`local-${Date.now()}-${this.jobCounter}`, data);
    this.jobs.push(job);
    this.emit('waiting', job);
    return job;
  }

  process(concurrency, handler) {
    if (typeof concurrency === 'function') {
      this.handler = concurrency;
      this.concurrency = 1;
    } else {
      this.concurrency = Number.isInteger(concurrency) && concurrency > 0 ? concurrency : 1;
      this.handler = handler;
    }

    this.kick();
  }

  kick() {
    setImmediate(() => this.runNext());
  }

  runNext() {
    if (!this.handler || this.activeCount >= this.concurrency) return;

    const job = this.jobs.shift();
    if (!job) return;

    this.activeCount += 1;
    this.emit('active', job);

    Promise.resolve()
      .then(() => this.handler(job))
      .then((result) => {
        this.emit('completed', job, result);
      })
      .catch((error) => {
        this.emit('failed', job, error);
      })
      .finally(() => {
        this.activeCount -= 1;
        this.kick();
      });
  }
}

module.exports = LocalVideoQueue;
