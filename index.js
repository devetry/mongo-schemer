const _ = require('lodash');
const { ObjectID } = require('mongodb');
const Ajv = require('ajv');
const AjvKeywords = require('ajv-keywords');
const MongoMock = require('mongo-mock');

const MongoMockUrl = 'mongodb://localhost:27017/mongo-schemer';
let db;
let schemaErrorCallback;

MongoMock.max_delay = 0;

const convertMongoSchemaToJsonSchema = (incomingSchema) => {
  const schema = incomingSchema;
  if (schema.bsonType && !schema.type) {
    schema.type = schema.bsonType;
    delete schema.bsonType;
  }
  if (schema.type === 'objectId') {
    delete schema.type;
    schema.instanceof = 'ObjectID';
  }
  if (schema.type === 'date') {
    delete schema.type;
    schema.instanceof = 'Date';
  }
  if (schema.type === 'object') {
    // The first param passed by _.forOwn is 'value', which is what we expect in convertMongoSchemaToJsonSchema
    _.forOwn(schema.properties, convertMongoSchemaToJsonSchema);
  }
  if (schema.type === 'array') {
    convertMongoSchemaToJsonSchema(schema.items);
  }
  if (schema.anyOf) {
    schema.anyOf.map(convertMongoSchemaToJsonSchema);
  }
  return schema;
};

const explainValidationError = async (collectionName, { doc, err }) => {
  const ajv = new Ajv({ $data: true });
  AjvKeywords(ajv);
  const instanceofDefinition = AjvKeywords.get('instanceof').definition;
  instanceofDefinition.CONSTRUCTORS.ObjectID = ObjectID;
  const collectionInfo = await db.command({ listCollections: 1, filter: { name: collectionName } });
  const schema = convertMongoSchemaToJsonSchema(collectionInfo.cursor.firstBatch[0].options.validator.$jsonSchema);
  if (!doc && err) {
    doc = err.getOperation(); // eslint-disable-line no-param-reassign
  }
  const valid = ajv.validate(schema, doc);
  if (!valid && schemaErrorCallback) {
    schemaErrorCallback(ajv.errors);
  }
  return true;
};

const explainSchemaErrors = (incomingDb) => {
  db = incomingDb;
  const originalCollection = db.collection;
  db.collection = function replacementCollection(...args) {
    const collectionName = args[0];
    const col = originalCollection.call(this, ...args);
    const originalInsertOne = col.insertOne;
    const originalInsertMany = col.insertMany;
    const originalUpdateOne = col.updateOne;
    const originalUpdateMany = col.updateMany;
    col.insertOne = async function replacementInsertOne(...ioArgs) {
      try {
        return await originalInsertOne.call(this, ...ioArgs);
      } catch (err) {
        if (err && err.code === 121) {
          explainValidationError(collectionName, { doc: ioArgs[0] });
        }
        throw err;
      }
    };
    col.insertMany = async function replacementInsertMany(...imArgs) {
      try {
        return await originalInsertMany.call(this, ...imArgs);
      } catch (err) {
        if (err && err.code === 121) {
          explainValidationError(collectionName, { err });
        }
        throw err;
      }
    };
    col.updateOne = async function replacementUpdateOne(...uoArgs) {
      try {
        return await originalUpdateOne.call(this, ...uoArgs);
      } catch (err) {
        if (err && err.code === 121) {
          // Get doc we're trying to update
          const currentDoc = await col.findOne(uoArgs[0]);
          // Load current doc into mock mongo
          const mockDb = await MongoMock.MongoClient.connect(MongoMockUrl);
          const mockCol = mockDb.collection('mock');
          await mockCol.insertOne(currentDoc);
          // Apply updates to our mock version of the current doc
          await mockCol.updateOne(...uoArgs);
          // Get updated doc from mock mongo to compare against schema
          const doc = await mockCol.findOne(uoArgs[0]);
          // mongo-mock changes how an _id looks, change it back
          doc._id = currentDoc._id;
          // Explain schema errors
          explainValidationError(collectionName, { doc });
          // Clean up MongoMock
          await mockCol.removeOne(...uoArgs);
        }
        throw err;
      }
    };
    col.updateMany = async function replacementUpdateMany(...umArgs) {
      try {
        return await originalUpdateMany.call(this, ...umArgs);
      } catch (err) {
        if (err && err.code === 121) {
          // Get docs we're trying to update
          const currentDocs = await col.find(umArgs[0]).toArray();
          // Load current docs into mock mongo
          const mockDb = await MongoMock.MongoClient.connect(MongoMockUrl);
          const mockCol = mockDb.collection('mock');
          await mockCol.insertMany(currentDocs);
          // Apply updates to our mock version of the current docs
          await mockCol.updateMany(...umArgs);
          // Get updated docs from mock mongo to compare against schema
          const docs = await mockCol.find(umArgs[0]).toArray();
          // mongo-mock changes how an _id looks, change it back
          for (let i = 0, { length } = docs; i < length; i++) {
            const currentDoc = currentDocs[i];
            const doc = docs[i];
            doc._id = currentDoc._id;
            // Explain schema errors
            explainValidationError(collectionName, { doc });
          }
          // Clean up MongoMock
          await mockCol.removeMany(...umArgs);
        }
        throw err;
      }
    };
    return col;
  };
  return db;
};

module.exports = {
  explainSchemaErrors,
  onError: (cb) => {
    schemaErrorCallback = cb;
  },
};
