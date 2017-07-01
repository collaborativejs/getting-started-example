var express = require('express');
var bodyParser = require('body-parser');
var uuid = require('uuid');
var clv = require('collaborativejs');


// create instance of the server with JSON support
var app = express();
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());


// crate in-memory storage
// Note: As far as Node.js is single-threaded by its nature, for the example application
// we can use regular JavaScript object here in the real life application, you will need
// to replace it with disk database like MongoDB, MySQL, PostgreSQL, etc or with in-memory database
// like Redis or Tarantool with replication to disk database.
var storage = {};

/**
 * Creates new document with Collaborative.js fields, saves it to the storage and returns.
 *
 * id - Unique string to identify the document, see docs at http://collaborativejs.org/api/clv#clvdocid
 * data - Data related to the document, depend on the type of the document can be one of the supported data types,
 * see docs at http://collaborativejs.org/docs/supported-data-types
 * ops - List of all operations that had ever made on the document.
 * These operations will be used in the transformation process due to undo, redo and other historical operations.
 * See operation definition at http://collaborativejs.org/api/clv#clvlocaloperation
 * execOrder - Index of last valid operation that had executed on the document, see docs at http://collaborativejs.org/api/clv#clvexecorder
 * context - Context object describes current state of the document on the certain site,
 * see docs at http://collaborativejs.org/api/clv#clvcontext
 *
 * @returns {Object}
 */
function createDocument() {
  // generate RFC4122 v4 UUID (random based) for the document.
  var id = uuid.v4();

  // Create new document
  var document = {
    id: id,
    data: 'Hello World',
    ops: [],
    execOrder: 0,
    context: null
  };

  // save to the storage
  storage[id] = document;

  return document;
}


/**
 * An endpoint to create or get existing document.
 * Note that in the Collaborative.js terminology, each client accessing the document is called site and must have an ID.
 * See http://collaborativejs.org/api/clv#clvsiteid to learn more about site IDs.
 */
app.post('/document/:id?', function(req, res) {
  var id = req.params.id;
  var document = null;

  // in case id is passed, look for the document
  // else create new one
  if (id) {
    document = storage[id];
  } else {
    document = createDocument();
  }

  // if document found in the storage or new one created
  if (document) {

    // generate RFC4122 v1 UUID (timestamp based) for the site.
    var siteId = uuid.v1();

    res.send(JSON.stringify({
      siteId: siteId,
      document: document
    }));
  } else {
    res.status(404);
    res.send('Not found');
  }
});


/**
 * todo
 */
app.post('/document/:id/update', function(req, res) {
  var documentId = req.params.id;
  var execOrder = req.body.execOrder;
  var updates = req.body.updates;
  var documentData = storage[documentId];

  if (documentData) {
    applyUpdates(documentData, updates);

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
 * todo
 */
function applyUpdates(documentData, updates) {
  var document = new clv.string.Document(null, documentData.execOrder, documentData.context);
  document.update(documentData.ops);

  for (var i = 0, count = updates.length; i < count; i++) {
    var op = updates[i];
    // check whenever op is valid op and it will not not corrupt document
    if (clv.ops.canApply(op, documentData.context)) {
      // check whenever op is have been already applied
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
        //    2. Incorrect network implementation.
        //    3. Unexpected network errors caused by network providers environment.
        // There are no additional actions required in case of receiving duplicate operations, just don't execute them.
        // In real world app, you also might want to have some error reporting here to fix first to cases.
      }
    } else {
      throw Error("One of the received ops is corrupted, can't apply this and all following ops.");
      // Note:
      // As far as we see there are only two possible cases of this error:
      //    1. Inappropriate front-end implementation.
      //    2. Unexpected network errors.
      // To avoid inappropriate update of the document, it is required to resend all corrupted operations.
      // In case you're using one of our Http implementations, you don't need to do anything, all ops will be re-sent
      // automatically, otherwise, you have to resend them yourself.
      // In real world app, you also might want to have some error reporting here.
    }
  }
}


/**
 * todo
 */
function searchForUpdates(documentData, execOrder) {
  return documentData.ops.filter(function(op) {
    return op.execOrder > execOrder;
  });
}


// run express server
app.listen(3000, function() {
  console.log('Example app listening on port ' + 3000 + '!');
});
