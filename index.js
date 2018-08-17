const _ = require('lodash');
const Ajv = require('ajv');
const AjvBsonType = require('ajv-bsontype');
const MongoMock = require('mongo-mock');

const ajv = new Ajv({ allErrors: true });
AjvBsonType(ajv);

const MongoMockUrl = 'mongodb://localhost:27017/mongo-schemer';

MongoMock.max_delay = 0;

const validationErrors = async (db, collectionName, { doc, err }) => {
  const collectionInfo = await db.command({ listCollections: 1, filter: { name: collectionName } });
  const schema = collectionInfo.cursor.firstBatch[0].options.validator.$jsonSchema;
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
          // Load current doc into mock mongo
          const mockDb = await MongoMock.MongoClient.connect(MongoMockUrl);
          const mockCol = mockDb.collection('mock');
          await mockCol.insertOne(currentDoc);
          // Apply updates to our mock version of the current doc
          await mockCol.updateOne(...uoArgs);
          // Get updated doc from mock mongo to compare against schema
          const doc = await mockCol.findOne(uoArgs[0]);
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
          // Load current docs into mock mongo
          const mockDb = await MongoMock.MongoClient.connect(MongoMockUrl);
          const mockCol = mockDb.collection('mock');
          await mockCol.insertMany(currentDocs);
          // Apply updates to our mock version of the current docs
          await mockCol.updateMany(...umArgs);
          // Get updated docs from mock mongo to compare against schema
          const docs = await mockCol.find(umArgs[0]).toArray();
          for (let i = 0, { length } = docs; i < length; i++) {
            const doc = docs[i];
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
