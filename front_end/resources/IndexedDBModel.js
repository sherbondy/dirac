/*
 * Copyright (C) 2012 Google Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * @unrestricted
 */
WebInspector.IndexedDBModel = class extends WebInspector.SDKModel {
  /**
   * @param {!WebInspector.Target} target
   * @param {!WebInspector.SecurityOriginManager} securityOriginManager
   */
  constructor(target, securityOriginManager) {
    super(WebInspector.IndexedDBModel, target);
    this._securityOriginManager = securityOriginManager;
    this._agent = target.indexedDBAgent();

    /** @type {!Map.<!WebInspector.IndexedDBModel.DatabaseId, !WebInspector.IndexedDBModel.Database>} */
    this._databases = new Map();
    /** @type {!Object.<string, !Array.<string>>} */
    this._databaseNamesBySecurityOrigin = {};
  }

  /**
   * @param {*} idbKey
   * @return {({
   *   array: (!Array<?>|undefined),
   *   date: (number|undefined),
   *   number: (number|undefined),
   *   string: (string|undefined),
   *   type: !Protocol.IndexedDB.KeyType<string>
   * }|undefined)}
   */
  static keyFromIDBKey(idbKey) {
    if (typeof(idbKey) === 'undefined' || idbKey === null)
      return undefined;

    var type;
    var key = {};
    switch (typeof(idbKey)) {
      case 'number':
        key.number = idbKey;
        type = WebInspector.IndexedDBModel.KeyTypes.NumberType;
        break;
      case 'string':
        key.string = idbKey;
        type = WebInspector.IndexedDBModel.KeyTypes.StringType;
        break;
      case 'object':
        if (idbKey instanceof Date) {
          key.date = idbKey.getTime();
          type = WebInspector.IndexedDBModel.KeyTypes.DateType;
        } else if (Array.isArray(idbKey)) {
          key.array = [];
          for (var i = 0; i < idbKey.length; ++i)
            key.array.push(WebInspector.IndexedDBModel.keyFromIDBKey(idbKey[i]));
          type = WebInspector.IndexedDBModel.KeyTypes.ArrayType;
        }
        break;
      default:
        return undefined;
    }
    key.type = /** @type {!Protocol.IndexedDB.KeyType<string>} */ (type);
    return key;
  }

  /**
   * @param {?IDBKeyRange=} idbKeyRange
   * @return {?Protocol.IndexedDB.KeyRange}
   * eturn {?{lower: ?Object, upper: ?Object, lowerOpen: *, upperOpen: *}}
   */
  static keyRangeFromIDBKeyRange(idbKeyRange) {
    if (typeof idbKeyRange === 'undefined' || idbKeyRange === null)
      return null;

    var keyRange = {};
    keyRange.lower = WebInspector.IndexedDBModel.keyFromIDBKey(idbKeyRange.lower);
    keyRange.upper = WebInspector.IndexedDBModel.keyFromIDBKey(idbKeyRange.upper);
    keyRange.lowerOpen = !!idbKeyRange.lowerOpen;
    keyRange.upperOpen = !!idbKeyRange.upperOpen;
    return keyRange;
  }

  /**
   * @param {!Protocol.IndexedDB.KeyPath} keyPath
   * @return {?string|!Array.<string>|undefined}
   */
  static idbKeyPathFromKeyPath(keyPath) {
    var idbKeyPath;
    switch (keyPath.type) {
      case WebInspector.IndexedDBModel.KeyPathTypes.NullType:
        idbKeyPath = null;
        break;
      case WebInspector.IndexedDBModel.KeyPathTypes.StringType:
        idbKeyPath = keyPath.string;
        break;
      case WebInspector.IndexedDBModel.KeyPathTypes.ArrayType:
        idbKeyPath = keyPath.array;
        break;
    }
    return idbKeyPath;
  }

  /**
   * @param {?string|!Array.<string>|undefined} idbKeyPath
   * @return {?string}
   */
  static keyPathStringFromIDBKeyPath(idbKeyPath) {
    if (typeof idbKeyPath === 'string')
      return '"' + idbKeyPath + '"';
    if (idbKeyPath instanceof Array)
      return '["' + idbKeyPath.join('", "') + '"]';
    return null;
  }

  /**
   * @param {!WebInspector.Target} target
   * @return {!WebInspector.IndexedDBModel}
   */
  static fromTarget(target) {
    var model = /** @type {?WebInspector.IndexedDBModel} */ (target.model(WebInspector.IndexedDBModel));
    if (!model)
      model = new WebInspector.IndexedDBModel(target, WebInspector.SecurityOriginManager.fromTarget(target));
    return model;
  }

  enable() {
    if (this._enabled)
      return;

    this._agent.enable();
    this._securityOriginManager.addEventListener(
        WebInspector.SecurityOriginManager.Events.SecurityOriginAdded, this._securityOriginAdded, this);
    this._securityOriginManager.addEventListener(
        WebInspector.SecurityOriginManager.Events.SecurityOriginRemoved, this._securityOriginRemoved, this);

    for (var securityOrigin of this._securityOriginManager.securityOrigins())
      this._addOrigin(securityOrigin);

    this._enabled = true;
  }

  /**
   * @param {string} origin
   */
  clearForOrigin(origin) {
    if (!this._enabled)
      return;

    this._removeOrigin(origin);
    this._addOrigin(origin);
  }

  refreshDatabaseNames() {
    for (var securityOrigin in this._databaseNamesBySecurityOrigin)
      this._loadDatabaseNames(securityOrigin);
  }

  /**
   * @param {!WebInspector.IndexedDBModel.DatabaseId} databaseId
   */
  refreshDatabase(databaseId) {
    this._loadDatabase(databaseId);
  }

  /**
   * @param {!WebInspector.IndexedDBModel.DatabaseId} databaseId
   * @param {string} objectStoreName
   * @param {function()} callback
   */
  clearObjectStore(databaseId, objectStoreName, callback) {
    this._agent.clearObjectStore(databaseId.securityOrigin, databaseId.name, objectStoreName, callback);
  }

  /**
   * @param {!WebInspector.Event} event
   */
  _securityOriginAdded(event) {
    var securityOrigin = /** @type {string} */ (event.data);
    this._addOrigin(securityOrigin);
  }

  /**
   * @param {!WebInspector.Event} event
   */
  _securityOriginRemoved(event) {
    var securityOrigin = /** @type {string} */ (event.data);
    this._removeOrigin(securityOrigin);
  }

  /**
   * @param {string} securityOrigin
   */
  _addOrigin(securityOrigin) {
    console.assert(!this._databaseNamesBySecurityOrigin[securityOrigin]);
    this._databaseNamesBySecurityOrigin[securityOrigin] = [];
    this._loadDatabaseNames(securityOrigin);
  }

  /**
   * @param {string} securityOrigin
   */
  _removeOrigin(securityOrigin) {
    console.assert(this._databaseNamesBySecurityOrigin[securityOrigin]);
    for (var i = 0; i < this._databaseNamesBySecurityOrigin[securityOrigin].length; ++i)
      this._databaseRemoved(securityOrigin, this._databaseNamesBySecurityOrigin[securityOrigin][i]);
    delete this._databaseNamesBySecurityOrigin[securityOrigin];
  }

  /**
   * @param {string} securityOrigin
   * @param {!Array.<string>} databaseNames
   */
  _updateOriginDatabaseNames(securityOrigin, databaseNames) {
    var newDatabaseNames = new Set(databaseNames);
    var oldDatabaseNames = new Set(this._databaseNamesBySecurityOrigin[securityOrigin]);

    this._databaseNamesBySecurityOrigin[securityOrigin] = databaseNames;

    for (var databaseName of oldDatabaseNames) {
      if (!newDatabaseNames.has(databaseName))
        this._databaseRemoved(securityOrigin, databaseName);
    }
    for (var databaseName of newDatabaseNames) {
      if (!oldDatabaseNames.has(databaseName))
        this._databaseAdded(securityOrigin, databaseName);
    }
  }

  /**
   * @return {!Array.<!WebInspector.IndexedDBModel.DatabaseId>}
   */
  databases() {
    var result = [];
    for (var securityOrigin in this._databaseNamesBySecurityOrigin) {
      var databaseNames = this._databaseNamesBySecurityOrigin[securityOrigin];
      for (var i = 0; i < databaseNames.length; ++i) {
        result.push(new WebInspector.IndexedDBModel.DatabaseId(securityOrigin, databaseNames[i]));
      }
    }
    return result;
  }

  /**
   * @param {string} securityOrigin
   * @param {string} databaseName
   */
  _databaseAdded(securityOrigin, databaseName) {
    var databaseId = new WebInspector.IndexedDBModel.DatabaseId(securityOrigin, databaseName);
    this.dispatchEventToListeners(WebInspector.IndexedDBModel.Events.DatabaseAdded, databaseId);
  }

  /**
   * @param {string} securityOrigin
   * @param {string} databaseName
   */
  _databaseRemoved(securityOrigin, databaseName) {
    var databaseId = new WebInspector.IndexedDBModel.DatabaseId(securityOrigin, databaseName);
    this.dispatchEventToListeners(WebInspector.IndexedDBModel.Events.DatabaseRemoved, databaseId);
  }

  /**
   * @param {string} securityOrigin
   */
  _loadDatabaseNames(securityOrigin) {
    /**
     * @param {?Protocol.Error} error
     * @param {!Array.<string>} databaseNames
     * @this {WebInspector.IndexedDBModel}
     */
    function callback(error, databaseNames) {
      if (error) {
        console.error('IndexedDBAgent error: ' + error);
        return;
      }

      if (!this._databaseNamesBySecurityOrigin[securityOrigin])
        return;
      this._updateOriginDatabaseNames(securityOrigin, databaseNames);
    }

    this._agent.requestDatabaseNames(securityOrigin, callback.bind(this));
  }

  /**
   * @param {!WebInspector.IndexedDBModel.DatabaseId} databaseId
   */
  _loadDatabase(databaseId) {
    /**
     * @param {?Protocol.Error} error
     * @param {!Protocol.IndexedDB.DatabaseWithObjectStores} databaseWithObjectStores
     * @this {WebInspector.IndexedDBModel}
     */
    function callback(error, databaseWithObjectStores) {
      if (error) {
        console.error('IndexedDBAgent error: ' + error);
        return;
      }

      if (!this._databaseNamesBySecurityOrigin[databaseId.securityOrigin])
        return;
      var databaseModel = new WebInspector.IndexedDBModel.Database(databaseId, databaseWithObjectStores.version);
      this._databases.set(databaseId, databaseModel);
      for (var i = 0; i < databaseWithObjectStores.objectStores.length; ++i) {
        var objectStore = databaseWithObjectStores.objectStores[i];
        var objectStoreIDBKeyPath = WebInspector.IndexedDBModel.idbKeyPathFromKeyPath(objectStore.keyPath);
        var objectStoreModel = new WebInspector.IndexedDBModel.ObjectStore(
            objectStore.name, objectStoreIDBKeyPath, objectStore.autoIncrement);
        for (var j = 0; j < objectStore.indexes.length; ++j) {
          var index = objectStore.indexes[j];
          var indexIDBKeyPath = WebInspector.IndexedDBModel.idbKeyPathFromKeyPath(index.keyPath);
          var indexModel =
              new WebInspector.IndexedDBModel.Index(index.name, indexIDBKeyPath, index.unique, index.multiEntry);
          objectStoreModel.indexes[indexModel.name] = indexModel;
        }
        databaseModel.objectStores[objectStoreModel.name] = objectStoreModel;
      }

      this.dispatchEventToListeners(WebInspector.IndexedDBModel.Events.DatabaseLoaded, databaseModel);
    }

    this._agent.requestDatabase(databaseId.securityOrigin, databaseId.name, callback.bind(this));
  }

  /**
   * @param {!WebInspector.IndexedDBModel.DatabaseId} databaseId
   * @param {string} objectStoreName
   * @param {?IDBKeyRange} idbKeyRange
   * @param {number} skipCount
   * @param {number} pageSize
   * @param {function(!Array.<!WebInspector.IndexedDBModel.Entry>, boolean)} callback
   */
  loadObjectStoreData(databaseId, objectStoreName, idbKeyRange, skipCount, pageSize, callback) {
    this._requestData(databaseId, databaseId.name, objectStoreName, '', idbKeyRange, skipCount, pageSize, callback);
  }

  /**
   * @param {!WebInspector.IndexedDBModel.DatabaseId} databaseId
   * @param {string} objectStoreName
   * @param {string} indexName
   * @param {?IDBKeyRange} idbKeyRange
   * @param {number} skipCount
   * @param {number} pageSize
   * @param {function(!Array.<!WebInspector.IndexedDBModel.Entry>, boolean)} callback
   */
  loadIndexData(databaseId, objectStoreName, indexName, idbKeyRange, skipCount, pageSize, callback) {
    this._requestData(
        databaseId, databaseId.name, objectStoreName, indexName, idbKeyRange, skipCount, pageSize, callback);
  }

  /**
   * @param {!WebInspector.IndexedDBModel.DatabaseId} databaseId
   * @param {string} databaseName
   * @param {string} objectStoreName
   * @param {string} indexName
   * @param {?IDBKeyRange} idbKeyRange
   * @param {number} skipCount
   * @param {number} pageSize
   * @param {function(!Array.<!WebInspector.IndexedDBModel.Entry>, boolean)} callback
   */
  _requestData(databaseId, databaseName, objectStoreName, indexName, idbKeyRange, skipCount, pageSize, callback) {
    /**
     * @param {?Protocol.Error} error
     * @param {!Array.<!Protocol.IndexedDB.DataEntry>} dataEntries
     * @param {boolean} hasMore
     * @this {WebInspector.IndexedDBModel}
     */
    function innerCallback(error, dataEntries, hasMore) {
      if (error) {
        console.error('IndexedDBAgent error: ' + error);
        return;
      }

      if (!this._databaseNamesBySecurityOrigin[databaseId.securityOrigin])
        return;
      var entries = [];
      for (var i = 0; i < dataEntries.length; ++i) {
        var key = this.target().runtimeModel.createRemoteObject(dataEntries[i].key);
        var primaryKey = this.target().runtimeModel.createRemoteObject(dataEntries[i].primaryKey);
        var value = this.target().runtimeModel.createRemoteObject(dataEntries[i].value);
        entries.push(new WebInspector.IndexedDBModel.Entry(key, primaryKey, value));
      }
      callback(entries, hasMore);
    }

    var keyRange = WebInspector.IndexedDBModel.keyRangeFromIDBKeyRange(idbKeyRange);
    this._agent.requestData(
        databaseId.securityOrigin, databaseName, objectStoreName, indexName, skipCount, pageSize,
        keyRange ? keyRange : undefined, innerCallback.bind(this));
  }
};

WebInspector.IndexedDBModel.KeyTypes = {
  NumberType: 'number',
  StringType: 'string',
  DateType: 'date',
  ArrayType: 'array'
};

WebInspector.IndexedDBModel.KeyPathTypes = {
  NullType: 'null',
  StringType: 'string',
  ArrayType: 'array'
};


/** @enum {symbol} */
WebInspector.IndexedDBModel.Events = {
  DatabaseAdded: Symbol('DatabaseAdded'),
  DatabaseRemoved: Symbol('DatabaseRemoved'),
  DatabaseLoaded: Symbol('DatabaseLoaded')
};

/**
 * @unrestricted
 */
WebInspector.IndexedDBModel.Entry = class {
  /**
   * @param {!WebInspector.RemoteObject} key
   * @param {!WebInspector.RemoteObject} primaryKey
   * @param {!WebInspector.RemoteObject} value
   */
  constructor(key, primaryKey, value) {
    this.key = key;
    this.primaryKey = primaryKey;
    this.value = value;
  }
};

/**
 * @unrestricted
 */
WebInspector.IndexedDBModel.DatabaseId = class {
  /**
   * @param {string} securityOrigin
   * @param {string} name
   */
  constructor(securityOrigin, name) {
    this.securityOrigin = securityOrigin;
    this.name = name;
  }

  /**
   * @param {!WebInspector.IndexedDBModel.DatabaseId} databaseId
   * @return {boolean}
   */
  equals(databaseId) {
    return this.name === databaseId.name && this.securityOrigin === databaseId.securityOrigin;
  }
};

/**
 * @unrestricted
 */
WebInspector.IndexedDBModel.Database = class {
  /**
   * @param {!WebInspector.IndexedDBModel.DatabaseId} databaseId
   * @param {number} version
   */
  constructor(databaseId, version) {
    this.databaseId = databaseId;
    this.version = version;
    this.objectStores = {};
  }
};

/**
 * @unrestricted
 */
WebInspector.IndexedDBModel.ObjectStore = class {
  /**
   * @param {string} name
   * @param {*} keyPath
   * @param {boolean} autoIncrement
   */
  constructor(name, keyPath, autoIncrement) {
    this.name = name;
    this.keyPath = keyPath;
    this.autoIncrement = autoIncrement;
    this.indexes = {};
  }

  /**
   * @return {string}
   */
  get keyPathString() {
    return /** @type {string}*/ (
        WebInspector.IndexedDBModel.keyPathStringFromIDBKeyPath(/** @type {string}*/ (this.keyPath)));
  }
};

/**
 * @unrestricted
 */
WebInspector.IndexedDBModel.Index = class {
  /**
   * @param {string} name
   * @param {*} keyPath
   * @param {boolean} unique
   * @param {boolean} multiEntry
   */
  constructor(name, keyPath, unique, multiEntry) {
    this.name = name;
    this.keyPath = keyPath;
    this.unique = unique;
    this.multiEntry = multiEntry;
  }

  /**
   * @return {string}
   */
  get keyPathString() {
    return /** @type {string}*/ (
        WebInspector.IndexedDBModel.keyPathStringFromIDBKeyPath(/** @type {string}*/ (this.keyPath)));
  }
};