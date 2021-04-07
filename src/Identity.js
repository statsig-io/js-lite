import * as utils from './utils/core';

export default function Identity(initialUser) {
  const identity = {};
  let user = {};
  let statsigMetadata = {
    stableID: utils.getStableID(),
    sessionID: utils.generateID(),
    sdkType: utils.getSDKType(),
    sdkVersion: utils.getSDKVersion(),
  };

  identity.setUser = function (newUser) {
    user = utils.clone(newUser);
    if (user == null) {
      user = {};
    }
    statsigMetadata.sessionID = utils.generateID();
    return true;
  };

  identity.getUser = function () {
    return utils.clone(user);
  };

  identity.getStatsigMetadata = function () {
    return statsigMetadata ? utils.clone(statsigMetadata) : {};
  };

  identity.getUserID = function () {
    return user.userID ?? statsigMetadata.stableID;
  };

  if (initialUser != null) {
    user = utils.clone(initialUser);
  }

  return identity;
}
