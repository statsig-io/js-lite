# Statsig

[![npm version](https://badge.fury.io/js/statsig-js-lite.svg)](https://badge.fury.io/js/statsig-js-lite)
[![jsdelivr](https://data.jsdelivr.com/v1/package/npm/statsig-js-lite/badge)](https://www.jsdelivr.com/package/npm/statsig-js-lite)

## Statsig JS with Local Evaluation SDK

A slimmed version of the [JavaScript](https://github.com/statsig-io/js-client) that behaves more like our server SDKs.  This SDK operates on the rule definitions to evaluate any gate/experiment locally.  This means when you change the user object or set of properties to check against, you do not need to make a network request to statsig - the SDK already has everything it needs to evaluate an arbitrary user object against an experiment or feature gate.  You can choose to host the rulesets for your project on your own CDN, or to inline them in your server page response.  

Statsig helps you move faster with feature gates (feature flags), and/or dynamic configs. It also allows you to run A/B/n tests to validate your new features and understand their impact on your KPIs. If you're new to Statsig, check out our product and create an account at [statsig.com](https://www.statsig.com).

## Getting Started
Check out our [SDK docs](https://docs.statsig.com/client/jsClientSDK) to get started.


## Supported Features
- Gate Checks
- Dynamic Configs
- Layers/Experiments
- Custom Event Logging


## Unsupported Features
- Local Overrides
- Prefetch Users
- Extended Browser Support
- Initialize Optimizations
