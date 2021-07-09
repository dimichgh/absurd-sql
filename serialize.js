let FINALIZED = 0xdeadbeef;

let WRITEABLE = 0;
let READABLE = 1;

export class Reader {
  constructor(
    buffer,
    { initialOffset = 4, useAtomics = true, stream = true, debug, name } = {}
  ) {
    this.buffer = buffer;
    this.atomicView = new Int32Array(buffer);
    this.offset = initialOffset;
    this.useAtomics = useAtomics;
    this.stream = stream;
    this.debug = debug;
    this.name = name;
  }

  log(...args) {
    if (this.debug) {
      console.log(`[reader: ${this.name}]`, ...args);
    }
  }

  waitWrite(name) {
    if (this.useAtomics) {
      this.log(`waiting for ${name}`);

      while (Atomics.load(this.atomicView, 0) === WRITEABLE) {
        // console.log('waiting for write...');
        Atomics.wait(this.atomicView, 0, WRITEABLE, 500);
      }

      this.log(`resumed for ${name}`);
    }
  }

  flip() {
    let prev = Atomics.compareExchange(this.atomicView, 0, READABLE, WRITEABLE);

    if (prev !== READABLE) {
      throw new Error('Read data out of sync! This is disastrous');
    }

    Atomics.notify(this.atomicView, 0);
    this.offset = 4;
  }

  // notify() {
  //   if (this.stream) {
  //     if (this.useAtomics) {
  //       // Switch to writable
  //       this.log('switching to writable');
  //       Atomics.store(this.atomicView, 0, 1);
  //       Atomics.notify(this.atomicView, 0);
  //     } else {
  //       this.atomicView[0] = 1;
  //     }
  //     this.offset = 4;
  //   }
  // }

  done(force) {
    this.log('checking done');
    this.waitWrite();

    let dataView = new DataView(this.buffer, this.offset);
    let done = dataView.getUint32(0) === FINALIZED;

    if (done) {
      this.flip();
    }

    return done;
  }

  string() {
    this.waitWrite();

    let byteLength = this._int32();
    let length = byteLength / 2;

    let dataView = new DataView(this.buffer, this.offset, byteLength);
    let chars = [];
    for (let i = 0; i < length; i++) {
      chars.push(dataView.getUint16(i * 2));
    }
    let str = String.fromCharCode.apply(null, chars);
    this.log('string', str);

    this.offset += byteLength;
    this.flip();
    return str;
  }

  _int32() {
    let byteLength = 4;

    let dataView = new DataView(this.buffer, this.offset);
    let num = dataView.getInt32();
    this.log('_int32', num);

    this.offset += byteLength;
    return num;
  }

  int32() {
    this.waitWrite();
    let num = this._int32();
    this.log('int32', num);
    this.flip();
    return num;
  }

  bytes() {
    this.waitWrite();

    let byteLength = this._int32();

    let bytes = new ArrayBuffer(byteLength);
    new Uint8Array(bytes).set(
      new Uint8Array(this.buffer, this.offset, byteLength)
    );
    this.log('bytes', bytes);

    this.offset += byteLength;
    this.flip();
    return bytes;
  }
}

export class Writer {
  constructor(
    buffer,
    { initialOffset = 4, useAtomics = true, stream = true, debug, name } = {}
  ) {
    this.buffer = buffer;
    this.atomicView = new Int32Array(buffer);
    this.offset = initialOffset;
    this.useAtomics = useAtomics;
    this.stream = stream;

    this.debug = debug;
    this.name = name;

    if (this.useAtomics) {
      // The buffer starts out as writeable
      Atomics.store(this.atomicView, 0, WRITEABLE);
    } else {
      this.atomicView[0] = 1;
    }
  }

  log(...args) {
    if (this.debug) {
      console.log(`[writer: ${this.name}]`, ...args);
    }
  }

  waitRead(name) {
    if (this.useAtomics) {
      this.log(`waiting for ${name}`);
      // Switch to writable
      // Atomics.store(this.atomicView, 0, 1);

      let prev = Atomics.compareExchange(
        this.atomicView,
        0,
        WRITEABLE,
        READABLE
      );

      if (prev !== WRITEABLE) {
        throw new Error(
          'Wrote something into unwritable buffer! This is disastrous'
        );
      }

      Atomics.notify(this.atomicView, 0);

      while (Atomics.load(this.atomicView, 0) === READABLE) {
        // console.log('waiting to be read...');
        Atomics.wait(this.atomicView, 0, READABLE, 500);
      }

      this.offset = 4;

      this.log(`resumed for ${name}`);
    }
  }

  wait() {
    if (this.useAtomics) {
      // Wait to be writable again
      this.log('waiting');

      if (Atomics.wait(this.atomicView, 0, 0, 100) === 'timed-out') {
        throw new Error(
          `[writer: ${this.name}] Writer cannot write: timed out`
        );
      }
      this.log('resumed');
    }
  }

  notify() {
    if (this.stream) {
      if (this.useAtomics) {
        // Flush it out. Switch to readable
        Atomics.store(this.atomicView, 0, 0);
        Atomics.notify(this.atomicView, 0);
        this.log('switching to readable');
      } else {
        this.atomicView[0] = 0;
      }
      this.offset = 4;
    }
  }

  finalize() {
    this.log('finalizing');
    let dataView = new DataView(this.buffer, this.offset);
    dataView.setUint32(0, FINALIZED);
    this.waitRead();
  }

  string(str) {
    this.log('string', str);

    let byteLength = str.length * 2;
    this._int32(byteLength);

    let dataView = new DataView(this.buffer, this.offset, byteLength);
    for (let i = 0; i < str.length; i++) {
      dataView.setUint16(i * 2, str.charCodeAt(i));
    }

    this.offset += byteLength;
    this.waitRead();
  }

  _int32(num) {
    let byteLength = 4;

    let dataView = new DataView(this.buffer, this.offset);
    dataView.setInt32(0, num);

    this.offset += byteLength;
  }

  int32(num) {
    this.log('int32', num);
    this._int32(num);
    this.waitRead();
  }

  bytes(buffer) {
    this.log('bytes', buffer);

    let byteLength = buffer.byteLength;
    this._int32(byteLength);
    new Uint8Array(this.buffer, this.offset).set(new Uint8Array(buffer));

    this.offset += byteLength;
    this.waitRead();
  }
}