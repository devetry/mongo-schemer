module.exports = {
  bsonType: 'object',
  definitions: {
    Stat: {
      bsonType: 'number',
      minimum: 0,
      maximum: 255,
    },
    Percent: {
      bsonType: 'number',
      minimum: 0,
      maximum: 100,
    },
  },
  properties: {
    element: {
      bsonType: 'array',
      items: {
        bsonType: 'string',
        enum: [
          // probably there are more, but maybe we've only seen
          // the starters so far!
          'Grass',
          'Poison',
          'Fire',
          'Water',
        ],
      },
    },
    stats: {
      bsonType: 'object',
      properties: {
        hp: { $ref: '#/definitions/Stat' },
        attack: { $ref: '#/definitions/Stat' },
        defense: { $ref: '#/definitions/Stat' },
        spattack: { $ref: '#/definitions/Stat' },
        spdefense: { $ref: '#/definitions/Stat' },
        speed: { $ref: '#/definitions/Stat' },
      },
      additionalProperties: false,
    },
    misc: {
      bsonType: 'object',
      properties: {
        sex: {
          bsonType: 'object',
          properties: {
            male: { $ref: '#/definitions/Percent' },
            female: { $ref: '#/definitions/Percent' },
          },
          additionalProperties: false,
        },
        classification: { bsonType: 'string' },
        // and some other properties...
      },
      additionalProperties: true,
    },
  },
  // we'll turn this off this later to make our schema more strict.
  // for now, it lets us get away with loading a partial schema.
  additionalProperties: true,
  required: [
    'element',
    'stats',
    'misc',
  ],
};
