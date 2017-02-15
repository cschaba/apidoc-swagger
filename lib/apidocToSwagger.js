var _ = require("lodash");
var pathToRegexp = require("path-to-regexp");

var swagger = {
    swagger: "2.0",
    info: {},
    paths: {},
    definitions: {}
};

function toSwagger(apidocJson, projectJson) {
    swagger.info = addInfo(projectJson);
    swagger.paths = extractPaths(apidocJson);
    return swagger;
}

var tagsRegex = /(<([^>]+)>)/ig;
// Removes <p> </p> tags from text
function removeTags(text) {
    return text ? text.replace(tagsRegex, "") : text;
}

function addInfo(projectJson) {
    var info = {};
    info.title = projectJson.title || projectJson.name;
    info.version = projectJson.version;
    info.description = projectJson.description;
    return info;
}

/**
 * Extracts paths provided in json format
 * post, patch, put request parameters are extracted in body
 * get and delete are extracted to path parameters
 * @param apidocJson
 * @returns {{}}
 */
function extractPaths(apidocJson) {
    var apiPaths = groupByUrl(apidocJson);
    var paths = {};
    for (var i = 0; i < apiPaths.length; i++) {
        var verbs = apiPaths[i].verbs;
        var url = verbs[0].url;
        var pattern = pathToRegexp(url, null);
        var matches = pattern.exec(url);

        // Surrounds URL parameters with curly brackets -> :email with {email}
        var pathKeys = [];
        var j = 0;
        for (j = 1; j < matches.length; j++) {
            var key = matches[j].substr(1);
            url = url.replace(matches[j], "{" + key + "}");
            pathKeys.push(key);
        }

        for (j = 0; j < verbs.length; j++) {
            var verb = verbs[j];
            var type = verb.type;

            var obj = paths[url] = paths[url] || {};

            if (type === "post" || type === "patch" || type === "put") {
                _.extend(obj, createPostPushPutOutput(verb, swagger.definitions, pathKeys));
            } else {
                _.extend(obj, createGetDeleteOutput(verb, swagger.definitions));
            }
        }
    }
    return paths;
}

function createPostPushPutOutput(verbs, definitions, pathKeys) {
    var pathItemObject = {};
    var verbDefinitionResult = createVerbDefinitions(verbs, definitions);

    var params = [];
    var pathParams = createPathParameters(verbs, pathKeys);
    pathParams = _.filter(pathParams, function(param) {
        var hasKey = pathKeys.indexOf(param.name) !== -1;
        return !(param.in === "path" && !hasKey);
    });

    params = params.concat(pathParams);
    var required = verbs.parameter && verbs.parameter.fields && verbs.parameter.fields.Parameter && verbs.parameter.fields.Parameter.length > 0;

    if (verbDefinitionResult.topLevelParametersRef) {
        params.push({
            "in": "body",
            "name": "body",
            "description": removeTags(verbs.description),
            "required": required,
            "schema": {
                "$ref": "#/definitions/" + verbDefinitionResult.topLevelParametersRef
            }
        });
    }

    pathItemObject[verbs.type] = {
        tags: [verbs.group],
        operationId: verbs.name,
        summary: verbs.title,
        description: removeTags(verbs.description),
        consumes: [
            "application/json"
        ],
        produces: [
            "application/json"
        ],
        parameters: params
    };

    if (verbDefinitionResult.topLevelSuccessRef) {
        pathItemObject[verbs.type].responses = {
            "200": {
                "description": "successful operation",
                "schema": {
                    "type": verbDefinitionResult.topLevelSuccessRefType,
                    "items": {
                        "$ref": "#/definitions/" + verbDefinitionResult.topLevelSuccessRef
                    }
                }
            }
        };
    } else {
        pathItemObject[verbs.type].responses = {
            "200": {
                "description": "apidoc2swagger missing response"
            }
        }
    }

    return pathItemObject;
}

function createVerbDefinitions(verbs, definitions) {
    var result = {
        topLevelParametersRef: null,
        topLevelSuccessRef: null,
        topLevelSuccessRefType: null
    };
    var defaultObjectName = verbs.name;

    var fieldArrayResultParameter = {};
    if (verbs && verbs.parameter && verbs.parameter.fields && verbs.parameter.fields.body) {
        fieldArrayResultParameter = createFieldArrayDefinitions(verbs.parameter.fields.body,
            definitions, verbs.name, defaultObjectName);
        result.topLevelParametersRef = fieldArrayResultParameter.topLevelRef;
    }

    // var fieldArrayResultSuccess = {};
    // if (verbs && verbs.success && verbs.success.fields) {
    //     fieldArrayResultSuccess = createFieldArrayDefinitions(verbs.success.fields["Success 200"],
    //         definitions, verbs.name, defaultObjectName);
    //     result.topLevelSuccessRef = fieldArrayResultSuccess.topLevelRef;
    //     result.topLevelSuccessRefType = fieldArrayResultSuccess.topLevelRefType;
    // }

    return result;
}

function createFieldArrayDefinitions(fieldArray, definitions, topLevelRef, defaultObjectName) {
    var result = {
        topLevelRef: topLevelRef,
        topLevelRefType: null
    };

    if (!fieldArray) {
        return result;
    }

    for (var i = 0; i < fieldArray.length; i++) {
        var parameter = fieldArray[i];

        var nestedName = createNestedName(parameter.field);
        var objectName = nestedName.objectName;
        if (!objectName) {
            objectName = defaultObjectName;
        }
        var type = parameter.type;
        if (i === 0) {
            result.topLevelRefType = type;
            if (parameter.type === "object") {
                objectName = nestedName.propertyName;
                nestedName.propertyName = null;
            } else if (parameter.type === "array") {
                objectName = nestedName.propertyName;
                nestedName.propertyName = null;
                result.topLevelRefType = "array";
            }
            result.topLevelRef = objectName;
        }

        definitions[objectName] = definitions[objectName] || {
            properties: {},
            required: []
        };

        if (nestedName.propertyName) {
            var prop = {
                type: (parameter.type || "").toLowerCase(),
                description: removeTags(parameter.description)
            };
            if (parameter.type === "object") {
                prop.$ref = "#/definitions/" + parameter.field;
            }

            if (typeIndex) {
                var typeIndex = type.indexOf("[]");
                if (typeIndex !== -1 && typeIndex === (type.length - 2)) {
                    prop.type = "array";
                    prop.items = {
                        type: type.slice(0, type.length - 2)
                    };
                }
            }

            definitions[objectName].properties[nestedName.propertyName] = prop;
            if (!parameter.optional) {
                var arr = definitions[objectName].required;
                if (arr.indexOf(nestedName.propertyName) === -1) {
                    arr.push(nestedName.propertyName);
                }
            }
        }
    }

    return result;
}

function createNestedName(field) {
    var propertyName = field;
    var objectName;
    var propertyNames = field.split(".");
    if (propertyNames && propertyNames.length > 1) {
        propertyName = propertyNames[propertyNames.length - 1];
        propertyNames.pop();
        objectName = propertyNames.join(".");
    }

    return {
        propertyName: propertyName,
        objectName: objectName
    };
}

/**
 * Generate get, delete method output
 * @param verbs
 * @returns {{}}
 */
function createGetDeleteOutput(verbs, definitions) {
    var pathItemObject = {};
    verbs.type = verbs.type === "del" ? "delete" : verbs.type;

    var verbDefinitionResult = createVerbDefinitions(verbs, definitions);
    pathItemObject[verbs.type] = {
        tags: [verbs.group],
        operationId: verbs.name,
        summary: verbs.title,
        description: removeTags(verbs.description),
        consumes: [
            "application/json"
        ],
        produces: [
            "application/json"
        ],
        parameters: createPathParameters(verbs)
    };
    if (verbDefinitionResult.topLevelSuccessRef) {
        pathItemObject[verbs.type].responses = {
            "200": {
                "description": "successful operation",
                "schema": {
                    "type": verbDefinitionResult.topLevelSuccessRefType,
                    "items": {
                        "$ref": "#/definitions/" + verbDefinitionResult.topLevelSuccessRef
                    }
                }
            }
        };
    } else {
        pathItemObject[verbs.type].responses = {
            "204": {
                "description": "apidoc2swagger missing response"
            }
        }
    }
    return pathItemObject;
}

/**
 * Iterate through all method parameters and create array of parameter objects which are stored as path parameters
 * @param verbs
 * @returns {Array}
 */
function createPathParameters(verbs, pathKeys) {
    pathKeys = pathKeys || [];

    var pathItemObject = [];
    if (verbs.parameter && verbs.parameter.fields) {
        // console.log("QQQ fields", verbs.parameter.fields);
        _.each(verbs.parameter.fields, function(thisBlock) {
            // console.log("QQQ thisBlock", thisBlock);
            _.each(thisBlock, function(field) {
                if (field.group !== "body") {
                    // console.log("QQQ field", field);
                    pathItemObject.push({
                        name: field.field,
                        in: field.group === "Parameter" ? 'path' : field.group, // FIXME: add "formData"
                        required: !field.optional,
                        type: (field.type || "").toLowerCase(),
                        // format: field.type === "number" ? 'long' : '',
                        description: removeTags(field.description)
                    });
                }
            });
        });
    }
    return pathItemObject;
}

function groupByUrl(apidocJson) {
    return _.chain(apidocJson)
        .groupBy("url")
        .pairs()
        .map(function(element) {
            return _.object(_.zip(["url", "verbs"], element));
        })
        .value();
}

module.exports = {
    toSwagger: toSwagger
};
