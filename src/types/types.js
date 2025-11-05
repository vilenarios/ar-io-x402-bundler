"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignatureConfig = void 0;
__exportStar(require("./winston"), exports);
var SignatureConfig;
(function (SignatureConfig) {
    SignatureConfig[SignatureConfig["ARWEAVE"] = 1] = "ARWEAVE";
    SignatureConfig[SignatureConfig["ED25519"] = 2] = "ED25519";
    SignatureConfig[SignatureConfig["ETHEREUM"] = 3] = "ETHEREUM";
    SignatureConfig[SignatureConfig["SOLANA"] = 4] = "SOLANA";
    SignatureConfig[SignatureConfig["INJECTEDAPTOS"] = 5] = "INJECTEDAPTOS";
    SignatureConfig[SignatureConfig["MULTIAPTOS"] = 6] = "MULTIAPTOS";
    SignatureConfig[SignatureConfig["TYPEDETHEREUM"] = 7] = "TYPEDETHEREUM";
    SignatureConfig[SignatureConfig["KYVE"] = 101] = "KYVE";
})(SignatureConfig = exports.SignatureConfig || (exports.SignatureConfig = {}));
