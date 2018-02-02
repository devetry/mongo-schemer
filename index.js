const _ = require('lodash');
const Ajv = require('ajv');
const AjvKeywords = require('ajv-keywords');
const MongoMock = require('mongo-mock');

const ajv = new Ajv({ allErrors: true });
AjvKeywords(ajv, 'instanceof');
// add special test for { objectid: true } in schema
ajv.addKeyword(
  'objectid',
  // eslint-disable-next-line
  { validate: (schema, data) => data._bsontype === 'ObjectID' },
);


const MongoMockUrl = 'mongodb://localhost:27017/mongo-schemer';

MongoMock.max_delay = 0;

const convertObjectIDsToStrings = (value) => {
  // Check if this is an ObjectID
  if (value.toHexString && value.getTimestamp) {
    return value.toHexString();
  } else if (_.isObject(value)) {
    return _.mapValues(value, convertObjectIDsToStrings);
  } else if (_.isArray(value)) {
    return _.map(value, convertObjectIDsToStrings);
  }
  return value;
};

const convertMongoSchemaToJsonSchema = (incomingSchema) => {
  const schema = incomingSchema;
  if (schema.bsonType && !schema.type) {
    schema.type = schema.bsonType;
    delete schema.bsonType;
  }
  if (schema.type === 'objectId') {
    delete schema.type;
    schema.objectid = true;
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

const validationErrors = async (db, collectionName, { doc, err }) => {
  const collectionInfo = await db.command({ listCollections: 1, filter: { name: collectionName } });
  const schema = convertMongoSchemaToJsonSchema(collectionInfo.cursor.firstBatch[0].options.validator.$jsonSchema);
  if (!doc && err) {
    doc = err.getOperation(); // eslint-disable-line no-param-reassign
  }
  const valid = ajv.validate(schema, doc);
  return { valid, errors: ajv.errors };
};

const explainSchemaErrors = (incomingDb, options = {}) => {
  const db = incomingDb;
  const { onError } = options;
  if (onError) {
    db.onValidationError = onError;
  }
  const explainValidationError = async (...args) => {
    const { valid, errors } = await validationErrors(...args);
    if (!valid) {
      db.onValidationError(errors);
    }
  };
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
          explainValidationError(db, collectionName, { doc: ioArgs[0] });
        }
        throw err;
      }
    };
    col.insertMany = async function replacementInsertMany(...imArgs) {
      try {
        return await originalInsertMany.call(this, ...imArgs);
      } catch (err) {
        if (err && err.code === 121) {
          explainValidationError(db, collectionName, { err });
        }
        throw err;
      }
    };
    col.updateOne = async function replacementUpdateOne(...uoArgsIncoming) {
      const uoArgs = uoArgsIncoming;
      try {
        return await originalUpdateOne.call(this, ...uoArgs);
      } catch (err) {
        if (err && err.code === 121) {
          // Get doc we're trying to update
          const currentDoc = await col.findOne(uoArgs[0]);
          // Remove ObjectIDs from filters
          uoArgs[0] = convertObjectIDsToStrings(uoArgs[0]);
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
          explainValidationError(db, collectionName, { doc });
          // Clean up MongoMock
          await mockCol.removeOne(...uoArgs);
        }
        throw err;
      }
    };
    col.updateMany = async function replacementUpdateMany(...umArgsIncoming) {
      const umArgs = umArgsIncoming;
      try {
        return await originalUpdateMany.call(this, ...umArgs);
      } catch (err) {
        if (err && err.code === 121) {
          // Get docs we're trying to update
          const currentDocs = await col.find(umArgs[0]).toArray();
          // Remove ObjectIDs from filters
          umArgs[0] = convertObjectIDsToStrings(umArgs[0]);
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
            explainValidationError(db, collectionName, { doc });
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
  validationErrors,
};
