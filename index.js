var express = require('express');
var bodyParser = require('body-parser');
var uuid = require('uuid');
var clv = require('collaborative');
var path = require('path');
var fs = require('fs');


// Creates server instance with JSON requests and static files support.
var app = express();
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());
app.use(express.static('node_modules/collaborative/dist'));


// Crates in-memory storage.
// Note: As far as Node.js is single-threaded by its nature, for the example application
// we can use regular JavaScript object. In the real life application, you will need to replace
// it with disk database (like MongoDB, MySQL, PostgreSQL, etc) or with in-memory database (like Redis, Tarantool, etc)
// with replication to disk database.
var storage = {};

/**
 * Creates new data for a new Collaborative.js document in the storage.
 * Data fields:
 *   id - Unique string to identify the document, see docs at http://collaborativejs.org/api/clv#clvdocid
 *   data - Data related to the document, depend on the type of the document can be one of the supported data types,
 *   see docs at http://collaborativejs.org/docs/supported-data-types
 *   ops - List of all operations that had ever made on the document.
 *   These operations will be used in the transformation process due to undo, redo and other historical operations.
 *   See operation definition at http://collaborativejs.org/api/clv#clvlocaloperation
 *   execOrder - Index of last valid operation that had executed on the document, see docs at http://collaborativejs.org/api/clv#clvexecorder
 *   context - Context object describes current state of the document on the certain site,
 *   see docs at http://collaborativejs.org/api/clv#clvcontext
 * @returns {Object}
 */
function createDocument() {
  // Generates RFC4122 v4 UUID (random based) for the document.
  var id = uuid.v4();

  // Creates new document data.
  var document = {
    id: id,
    data: 'Hello World',
    ops: [],
    execOrder: 0,
    context: null
  };

  // Saves to the storage.
  storage[id] = document;

  return document;
}


/**
 * Defines an endpoint to access the document.
 * Note: In the Collaborative.js terminology, each client accessing the document is called site and must have an ID.
 * See http://collaborativejs.org/api/clv#clvsiteid to learn more about site IDs.
 */
app.get('/document/:id?', function(req, res) {
  var documentId = req.params.id;
  var document = null;

  // If document id is passed, looks for the document data else creates new one.
  if (documentId) {
    document = storage[documentId];
  } else {
    document = createDocument();
  }

  if (document) {
    // Generates RFC4122 v1 UUID (timestamp based) for the site.
    var id = uuid.v1();

    // Generate site data.
    var site = {id: id, document: document};

    // For example application we are using a fs.readFileSync and string replace methods to render a page,
    // in real world application you might use one of the dozens Node.js templating engines.
    var template = fs.readFileSync(__dirname + '/index.html').toString();
    var page = template.replace("'{{site}}'", JSON.stringify(site));

    res.send(page);
  } else {
    res.status(404);
    res.send('Document not found');
  }
});


/**
 * Defines an endpoint to update the document on the server and other sites connected to the document.
 */
app.post('/document/:id/update', function(req, res) {
  var documentId = req.params.id;
  var execOrder = req.body.execOrder;
  var updates = req.body.updates;

  // Looks for the document data in the storage
  var documentData = storage[documentId];

  if (documentData) {
    // apply updates to the document
    applyUpdates(documentData, updates);

    // Looks for the updates for the site
    var response = {
      updates: searchForUpdates(documentData, execOrder)
    };

    res.status(200);
    res.send(JSON.stringify(response));
  } else {
    res.status(500);
    res.send('Document with id ' + documentId + 'not found');
  }
});


/**
 * Updates document data, the results of the update process are
 * 1. New document data value.
 * 2. Updated list of document operations.
 * 3. New document context value.
 * 4. New document execOrder value.
 */
function applyUpdates(documentData, updates) {
  var document = new clv.string.Document(null, documentData.execOrder, documentData.context);
  document.update(documentData.ops);

  for (var i = 0, count = updates.length; i < count; i++) {
    var op = updates[i];
    // Checks whenever operation is valid and will not corrupt the document
    if (clv.ops.canApply(op, documentData.context)) {
      // Checks whenever operation have been already applied
      if (!clv.ops.seen(op, documentData.context)) {
        op.execOrder = documentData.ops.length + 1;
        var tuple = document.update(op);
        documentData.data = clv.ops.string.exec(documentData.data, tuple.toExec);
        documentData.context = document.getContext();
        documentData.ops.push(op);
        documentData.execOrder = document.getExecOrder();
      } else {
        // Note:
        // As far as we see there are three possible cases of receiving duplicate operations:
        //    1. Incorrect front-end implementation.
        //    2. Incorrect network implementation (In case of custom implementation instead of clv.net objects).
        //    3. Unexpected network errors caused by network providers environment.
        // There are no additional actions required in case of receiving duplicate operations, just don't execute them.
        // In real world app, you also might want to have some error reporting here.
      }
    } else {
      throw Error("One of the received operations is corrupted, can't apply this and all following operations.");
      // Note:
      // As far as we see there are only two possible cases of this error:
      //    1. Incorrect front-end implementation.
      //    2. Unexpected network errors caused by network providers environment.
      // To avoid corruption of the whole document, it is required to resend all corrupted operations.
      // In case you're using clv.net objects, you don't need to do anything, all operations will be re-sent
      // automatically, otherwise, you have to resend them yourself.
      // In real world app, you also might want to have some error reporting here.
    }
  }
}


/**
 * Looks for the updates to send.
 * All operations with exec order greater than passed should be sent to the requester site.
 * @returns {Array}
 */
function searchForUpdates(documentData, execOrder) {
  return documentData.ops.filter(function(op) {
    return op.execOrder > execOrder;
  });
}


// Runs express server
app.listen(3000, function() {
  console.log('Example app listening on port ' + 3000 + '!');
});
