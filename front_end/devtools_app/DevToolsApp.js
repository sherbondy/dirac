// Copyright 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * @constructor
 * @suppressGlobalPropertiesCheck
 */
function DevToolsApp()
{
    if (DevToolsHost.isUnderTest())
        self.runtime.useTestBase();

    this._iframe = document.getElementById("inspector-app-iframe");
    this._inspectorFrontendHostImpl = new InspectorFrontendHostImpl();

    /**
     * @type {!Window}
     */
    this._inspectorWindow = this._iframe.contentWindow;
    this._inspectorWindow.InspectorFrontendHost = this._inspectorFrontendHostImpl;
    DevToolsAPI.setInspectorWindow(this._inspectorWindow);

    this._iframe.focus();
    this._iframe.addEventListener("load", this._onIframeLoad.bind(this), false);
}

DevToolsApp.prototype = {
    _onIframeLoad: function()
    {
        /**
         * @this {CSSStyleDeclaration}
         */
        function getValue(property)
        {
            // Note that |property| comes from another context, so we can't use === here.
            if (property == "padding-left") {
                return {
                    /**
                     * @suppressReceiverCheck
                     * @this {Object}
                     */
                    getFloatValue: function() { return this.__paddingLeft; },
                    __paddingLeft: parseFloat(this.paddingLeft)
                };
            }
            throw new Error("getPropertyCSSValue is undefined");
        }

        // Support for legacy (<M41) frontends. Remove in M45.
        this._iframe.contentWindow.CSSStyleDeclaration.prototype.getPropertyCSSValue = getValue;
        this._iframe.contentWindow.CSSPrimitiveValue = { CSS_PX: "CSS_PX" };

        // Support for legacy (<M44) frontends. Remove in M48.
        var styleElement = this._iframe.contentWindow.document.createElement("style");
        styleElement.type = "text/css";
        styleElement.textContent = "html /deep/ * { min-width: 0; min-height: 0; }";
        this._iframe.contentWindow.document.head.appendChild(styleElement);
    }
}

runOnWindowLoad(function() { new DevToolsApp(); });
