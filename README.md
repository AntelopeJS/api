![API](.github/social-card.png)

# @antelopejs/api

[![npm version](https://img.shields.io/npm/v/@antelopejs/api.svg)](https://www.npmjs.com/package/@antelopejs/api)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)

A lightweight, flexible HTTP/WebSocket API module that implements the interface API of antelopejs.

For detailed documentation on the API interface, please refer to the [docs](https://github.com/AntelopeJS/interface-api).

## Installation

```bash
ajs project modules add @antelopejs/api
```

## Overview

The AntelopeJS API module provides a robust HTTP and WebSocket server implementation with a controller-based approach for building REST APIs and real-time applications. It supports:

- HTTP and HTTPS servers
- WebSocket connections
- Controller-based routing
- Parameter injection
- Middleware support
- CORS configuration

## Configuration

The API module can be configured with the following options:

```json
{
  "servers": [
    {
      "protocol": "http",
      "host": "localhost",
      "port": 8080
    },
    {
      "protocol": "https",
      "host": "localhost",
      "port": 8443,
      "cert": "path-to-cert",
      "key": "path-to-key"
    }
  ],
  "cors": {
    "allowedOrigins": ["https://example.com", "https://api.example.net"],
    "allowedMethods": ["GET", "POST", "PUT", "DELETE"]
  }
}
```

### Server Configuration

The module supports both HTTP and HTTPS servers. If no servers are configured, it defaults to HTTP on port 80.

Each server in the `servers` array can have the following properties:

- `protocol`: Either "http" or "https"
- `host`: (Optional) The hostname to bind to
- `port`: (Optional) The port to listen on
- Additional properties from Node.js http.ServerOptions or https.ServerOptions, such as `cert` and `key` for HTTPS

### CORS Configuration

The API module automatically adds a middleware for CORS support, which can be configured with:

- `allowedOrigins`: An array of allowed origins or regular expressions
- `allowedMethods`: An array of allowed HTTP methods

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.
