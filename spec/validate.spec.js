const _ = require('lodash');
const $RefParser = require('json-schema-ref-parser');
const { MongoClient } = require('mongodb');
const pokemonSchema = require('./pokemonSchema');
const MongoSchemer = require('../index.js');

const dbUrl = `mongodb://localhost:${process.env.MONGO_PORT || 27017}/`;
const dbName = 'mongo-schemer';

describe('Mongo Explain Validate Errors', () => {
  const collectionName = 'test';
  let client;
  let db;

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
    db.onValidationError = (errors) => {
      expect(errors.length).toBe(2);
      expect(errors[0].keyword).toBe('bsonType');
      expect(errors[0].dataPath).toBe('.created');
      expect(errors[1].keyword).toBe('additionalProperties');
      expect(errors[1].dataPath).toBe('.items[0]');

      done();
    };
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
  it('does not fail when doc is valid', async (done) => {
    const col = db.collection(collectionName);
    db.onValidationError = () => {
      done.fail('expected this doc to be valid');
    };
    try {
      await col.insertOne({
        name: 'test2',
        type: 'second',
        created: new Date(),
        items: [
          {
            description: 'Second item',
          },
        ],
      });
    } catch (err) {
      done.fail(err);
    }
    done();
  });

  it('explains insertMany validation error', async (done) => {
    const col = db.collection(collectionName);
    db.onValidationError = (errors) => {
      expect(errors.length).toBe(1);
      expect(errors[0].keyword).toBe('additionalProperties');
      expect(errors[0].dataPath).toBe('.items[0]');
      done();
    };
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

  it('explains findOneAndUpdate validation error', async (done) => {
    const col = db.collection(collectionName);
    db.onValidationError = (errors) => {
      expect(errors).toEqual([
        {
          keyword: 'bsonType',
          params: { bsonType: 'string' },
          message: 'should be string got Earth,Electricity',
          dataPath: '.type',
          schemaPath: '#/properties/type/bsonType',
        },
      ]);
      done();
    };
    try {
      await col.findOneAndUpdate({
        name: 'test1',
      }, {
        $set: {
          type: ['Earth', 'Electricity'],
        },
      });
      done();
    } catch (err) {
      if (err.code !== 121) {
        done.fail('Failed with non-validation error');
      }
    }
  });

  it('explains updateOne validation error', async (done) => {
    const col = db.collection(collectionName);
    db.onValidationError = (errors) => {
      expect(errors.length).toBe(1);
      expect(errors[0].keyword).toBe('bsonType');
      expect(errors[0].dataPath).toBe('.created');
      done();
    };
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
    db.onValidationError = (errors) => {
      expect(errors.length).toBe(1);
      expect(errors[0].keyword).toBe('bsonType');
      expect(errors[0].dataPath).toBe('.created');
      errorsReported += 1;
      if (errorsReported === 2) {
        done();
      }
    };
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
  it('connects to Mongo with Mongo Schemer options', async (done) => {
    client = await MongoClient.connect(dbUrl);
    db = MongoSchemer.explainSchemaErrors(client.db(dbName), { includeValidationInError: true });
    done();
  });
  it('returns validation error result', async (done) => {
    const col = db.collection(collectionName);
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
      expect(err.validationErrors.length).toBe(2);
      expect(err.validationErrors[0].keyword).toBe('bsonType');
      expect(err.validationErrors[0].dataPath).toBe('.created');
      expect(err.validationErrors[1].keyword).toBe('additionalProperties');
      expect(err.validationErrors[1].dataPath).toBe('.items[0]');
      return done();
    }
    done.fail('Validation errors not included in thrown error');
    return null;
  });
  it('drops test database', async (done) => {
    await db.dropDatabase();
    done();
  });
});

describe('Pokemon tests', () => {
  const collectionName = 'pokemon';
  let client;
  let db;


  it('connects to Mongo', async () => {
    client = await MongoClient.connect(dbUrl);
    db = MongoSchemer.explainSchemaErrors(client.db(dbName));
  });

  it('adds test validator', async () => {
    // Create collection
    const inlinedSchema = await $RefParser.dereference(pokemonSchema);
    delete inlinedSchema.definitions;

    await db.createCollection(collectionName, {
      validator: { $jsonSchema: pokemonSchema },
    });
  });

  it("doesn't add dragons", async (done) => {
    const col = db.collection(collectionName);
    db.onValidationError = (errors) => {
      expect(_.map(errors, 'dataPath'))
        .toEqual([
          '.element[0]',
          '.element[1]',
          '.stats',
          '',
        ]);
      done();
    };
    try {
      await col.insertOne({
        name: 'Norberta',
        element: [
          'Flying',
          'Norwegian Ridge-back',
        ],
        stats: 'no thanks',
      });
    } catch (err) {
      if (err.code !== 121) {
        done.fail('Failed with non-validation error');
      }
    }
  });

  it('recognizes missing properties', async (done) => {
    const col = db.collection(collectionName);
    db.onValidationError = (errors) => {
      expect(errors.length).toBe(1);
      expect(errors[0].message).toEqual("should have required property 'misc'");
      done();
    };
    try {
      await col.insertOne({
        id: '001',
        name: 'Bulbasaur',
        img: 'http://img.pokemondb.net/artwork/bulbasaur.jpg',
        element: [
          'Grass',
          'Poison',
        ],
        stats: {
          hp: 45,
          attack: 49,
          defense: 49,
          spattack: 65,
          spdefense: 65,
          speed: 45,
        },
      });
      done.fail('expected to fail with validation error');
    } catch (err) {
      if (err.code !== 121) {
        done.fail('Failed with non-validation error');
      }
    }
  });

  it('reports on dereferenced definitions', async (done) => {
    const col = db.collection(collectionName);
    db.onValidationError = (errors) => {
      expect(errors).toEqual([{
        keyword: 'bsonType',
        dataPath: '.stats.attack',
        schemaPath: '#/properties/stats/properties/attack/bsonType',
        params: { bsonType: 'number' },
        message: 'should be number got 49',
      }, {
        keyword: 'bsonType',
        dataPath: '.stats.speed',
        schemaPath: '#/properties/stats/properties/speed/bsonType',
        params: { bsonType: 'number' },
        message: 'should be number got 45',
      }]);
      done();
    };
    try {
      await col.insertOne({
        id: '001',
        name: 'Bulbasaur',
        img: 'http://img.pokemondb.net/artwork/bulbasaur.jpg',
        element: [
          'Grass',
          'Poison',
        ],
        stats: {
          hp: 45,
          attack: '49',
          defense: 49,
          spattack: 65,
          spdefense: 65,
          speed: '45',
        },
        misc: {},
      });
      done.fail('expected to fail with validation error');
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
