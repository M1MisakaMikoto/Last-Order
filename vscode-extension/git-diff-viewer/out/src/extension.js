"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const controller_1 = require("./controller");
let controller;
function activate(context) {
    controller = new controller_1.DiffViewerController(context);
    context.subscriptions.push(controller);
}
function deactivate() {
    controller?.dispose();
    controller = undefined;
}
//# sourceMappingURL=extension.js.map