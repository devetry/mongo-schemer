# mongo-schemer

Provides clear Mongo schema validation error messages by running all validation errors through `ajv`. Does this by wrapping your Mongo client `db` in order to catch validation errors and compare against your schema.

## Requirements

- Your schema validation has to be in $jsonSchema format. More info here: https://docs.mongodb.com/manual/core/schema-validation/
- Currently only supports Promise-based usage of Mongo. PRs welcome!

## Installation

```
npm install mongo-schemer
```

## Usage

Wrap your `db` with `MongoSchemer.explainSchemaErrors()`:

```
const { MongoClient } = require('mongodb');
const MongoSchemer = require('mongo-schemer');

MongoClient.connect(dbUrl).then((client) => {
  const db = client.db(dbName);
  if (process.env.DEV) {
    db = MongoSchemer.explainSchemaErrors(db, {
      onError: (errors) => { console.log(errors); },
      includeValidationInError: true,
    });
  }
});
```
**Options**  
`onError` allows the enhanced validation errors to be dealt with within its callback. Optional.

`includeValidationInError` includes the enhanced validation errors within the original MongoDB error under the key `validationErrors`. This allows the error to be handled at any point in its callstack. Optional.

**Example Error**  
If using the `onError` callback only the `validationErrors` array is provided:
```
{
  message: "Document failed validation",
  ..., // original error details
  validationErrors: [
    {
      message: 'should be date got this should be a date instead',
      keyword: 'bsonType',
      params: { bsonType: 'date' },
      dataPath: '.created',
      schemaPath: '#/properties/created/bsonType'
    },
    {
      message: 'should NOT have additional properties',
      keyword: 'additionalProperties',
      params: { additionalProperty: 'extraFieldThatDoesNotExist' },
      dataPath: '.items[0]',
      schemaPath: '#/properties/items/items/additionalProperties'
    }
  ]
}
```
See tests for more details.

**Production Usage**  
Running in prod is not recommended due to the overhead of validating documents against the schema.

## Caveats

MongoDB does not currently support `definitions` in the JSON Schema. However, there is an easy workaround using `json-schema-ref-parser`. See https://brianschiller.com/blog/2018/01/30/pokemon-mongo-schemer for more information.