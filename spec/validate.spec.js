const { MongoClient } = require('mongodb');

const MongoSchemer = require('../index.js');

const dbUrl = 'mongodb://localhost:27017/';
const dbName = 'mongo-schemer';
const collectionName = 'test';
let client;
let db;

describe('Mongo Explain Validate Errors', () => {
  it('connects to Mongo', async (done) => {
    client = await MongoClient.connect(dbUrl);
    db = MongoSchemer.explainSchemaErrors(client.db(dbName));
    done();
  });
  it('adds test validator', async (done) => {
    // Create collection
    await db.createCollection(collectionName);
    // Add validator
    try {
      await db.command({
        collMod: collectionName,
        validator: {
          $jsonSchema: {
            bsonType: 'object',
            additionalProperties: false,
            required: ['name', 'created'],
            properties: {
              _id: {
                bsonType: 'objectId',
              },
              name: {
                bsonType: 'string',
              },
              type: {
                bsonType: 'string',
              },
              created: {
                bsonType: 'date',
              },
              items: {
                bsonType: 'array',
                items: {
                  bsonType: 'object',
                  additionalProperties: false,
                  properties: {
                    description: {
                      bsonType: 'string',
                    },
                  },
                },
              },
            },
          },
        },
      });
      done();
    } catch (err) {
      done.fail('Failed to create validator');
    }
  });
  it('adds test data', async (done) => {
    const col = db.collection(collectionName);
    try {
      await col.insertMany([
        {
          name: 'test1',
          type: 'first',
          created: new Date(),
          items: [
            {
              description: 'First item',
            },
          ],
        },
        {
          name: 'test2',
          type: 'first',
          created: new Date(),
          items: [
            {
              description: 'First item',
            },
          ],
        },
        {
          name: 'test3',
          type: 'second',
          created: new Date(),
          items: [
            {
              description: 'First item',
            },
          ],
        },
      ]);
      done();
    } catch (err) {
      done.fail('Failed to create test data');
    }
  });
  it('explains insertOne validation error', async (done) => {
    const col = db.collection(collectionName);
    MongoSchemer.onError((errors) => {
      expect(errors.length).toBe(1);
      expect(errors[0].keyword).toBe('instanceof');
      expect(errors[0].dataPath).toBe('.created');
      done();
    });
    try {
      await col.insertOne({
        name: 'test1',
        type: 'first',
        created: 'this should be a date instead',
        items: [
          {
            description: 'First item',
            extraFieldThatDoesNotExist: true,
          },
        ],
      });
    } catch (err) {
      if (err.code !== 121) {
        done.fail('Failed with non-validation error');
      }
    }
  });
  it('explains insertMany validation error', async (done) => {
    const col = db.collection(collectionName);
    MongoSchemer.onError((errors) => {
      expect(errors.length).toBe(1);
      expect(errors[0].keyword).toBe('additionalProperties');
      expect(errors[0].dataPath).toBe('.items[0]');
      done();
    });
    try {
      await col.insertMany([
        {
          name: 'test1',
          type: 'first',
          created: new Date(),
          items: [
            {
              description: 'First item',
              extraFieldThatDoesNotExist: true,
            },
          ],
        },
        {
          name: 'test2',
          type: 'first',
          created: new Date(),
          items: [
            {
              description: 'First item',
            },
          ],
        },
      ]);
      done();
    } catch (err) {
      if (err.code !== 121) {
        done.fail('Failed with non-validation error');
      }
    }
  });
  it('explains updateOne validation error', async (done) => {
    const col = db.collection(collectionName);
    MongoSchemer.onError((errors) => {
      expect(errors.length).toBe(1);
      expect(errors[0].keyword).toBe('instanceof');
      expect(errors[0].dataPath).toBe('.created');
      done();
    });
    try {
      await col.updateOne({
        name: 'test1',
      }, {
        $set: {
          created: 'this should be a date instead',
        },
      });
      done();
    } catch (err) {
      if (err.code !== 121) {
        done.fail('Failed with non-validation error');
      }
    }
  });
  it('explains updateMany validation error', async (done) => {
    const col = db.collection(collectionName);
    let errorsReported = 0;
    MongoSchemer.onError((errors) => {
      expect(errors.length).toBe(1);
      expect(errors[0].keyword).toBe('instanceof');
      expect(errors[0].dataPath).toBe('.created');
      errorsReported += 1;
      if (errorsReported === 2) {
        done();
      }
    });
    try {
      await col.updateMany({
        type: 'first',
      }, {
        $set: {
          created: 'this should be a date instead',
        },
      });
      done();
    } catch (err) {
      if (err.code !== 121) {
        done.fail('Failed with non-validation error');
      }
    }
  });
  it('drops test database', async (done) => {
    await db.dropDatabase();
    done();
  });
});
