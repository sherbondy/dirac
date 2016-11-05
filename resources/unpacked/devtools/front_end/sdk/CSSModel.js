/*
 * Copyright (C) 2010 Google Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * @unrestricted
 */
WebInspector.CSSModel = class extends WebInspector.SDKModel {
  /**
   * @param {!WebInspector.Target} target
   * @param {!WebInspector.DOMModel} domModel
   */
  constructor(target, domModel) {
    super(WebInspector.CSSModel, target);
    this._domModel = domModel;
    this._agent = target.cssAgent();
    this._styleLoader = new WebInspector.CSSModel.ComputedStyleLoader(this);
    WebInspector.targetManager.addEventListener(
        WebInspector.TargetManager.Events.MainFrameNavigated, this._mainFrameNavigated, this);
    target.registerCSSDispatcher(new WebInspector.CSSDispatcher(this));
    this._agent.enable().then(this._wasEnabled.bind(this));
    /** @type {!Map.<string, !WebInspector.CSSStyleSheetHeader>} */
    this._styleSheetIdToHeader = new Map();
    /** @type {!Map.<string, !Object.<!Protocol.Page.FrameId, !Array.<!Protocol.CSS.StyleSheetId>>>} */
    this._styleSheetIdsForURL = new Map();

    /** @type {!Map.<!WebInspector.CSSStyleSheetHeader, !Promise<string>>} */
    this._originalStyleSheetText = new Map();

    /** @type {!Multimap<string, !Protocol.CSS.StyleSheetId>} */
    this._sourceMapLoadingStyleSheetsIds = new Multimap();

    /** @type {!Map<string, !WebInspector.SourceMap>} */
    this._sourceMapByURL = new Map();
    /** @type {!Multimap<string, !WebInspector.CSSStyleSheetHeader>} */
    this._sourceMapURLToHeaders = new Multimap();
    WebInspector.moduleSetting('cssSourceMapsEnabled').addChangeListener(this._toggleSourceMapSupport, this);
  }

  /**
   * @param {string} text
   * @return {string}
   */
  static trimSourceURL(text) {
    var sourceURLIndex = text.lastIndexOf('/*# sourceURL=');
    if (sourceURLIndex === -1) {
      sourceURLIndex = text.lastIndexOf('/*@ sourceURL=');
      if (sourceURLIndex === -1)
        return text;
    }
    var sourceURLLineIndex = text.lastIndexOf('\n', sourceURLIndex);
    if (sourceURLLineIndex === -1)
      return text;
    var sourceURLLine = text.substr(sourceURLLineIndex + 1).split('\n', 1)[0];
    var sourceURLRegex = /[\040\t]*\/\*[#@] sourceURL=[\040\t]*([^\s]*)[\040\t]*\*\/[\040\t]*$/;
    if (sourceURLLine.search(sourceURLRegex) === -1)
      return text;
    return text.substr(0, sourceURLLineIndex) + text.substr(sourceURLLineIndex + sourceURLLine.length + 1);
  }

  /**
   * @param {!WebInspector.Target} target
   * @return {?WebInspector.CSSModel}
   */
  static fromTarget(target) {
    return /** @type {?WebInspector.CSSModel} */ (target.model(WebInspector.CSSModel));
  }

  /**
   * @param {!WebInspector.DOMNode} node
   * @return {!WebInspector.CSSModel}
   */
  static fromNode(node) {
    return /** @type {!WebInspector.CSSModel} */ (WebInspector.CSSModel.fromTarget(node.target()));
  }

  /**
   * @param {!WebInspector.Event} event
   */
  _toggleSourceMapSupport(event) {
    var enabled = /** @type {boolean} */ (event.data);
    var headers = this.styleSheetHeaders();
    for (var header of headers) {
      if (enabled)
        this._attachSourceMap(header);
      else
        this._detachSourceMap(header);
    }
  }

  /**
   * @param {!WebInspector.CSSStyleSheetHeader} header
   * @return {?WebInspector.SourceMap}
   */
  sourceMapForHeader(header) {
    return this._sourceMapByURL.get(header.sourceMapURL) || null;
  }

  _sourceMapLoadedForTest() {
  }

  /**
   * @param {!WebInspector.SourceMap} sourceMap
   * @return {!Array<!WebInspector.CSSStyleSheetHeader>}
   */
  headersForSourceMap(sourceMap) {
    return this._sourceMapURLToHeaders.get(sourceMap.url()).valuesArray();
  }

  /**
   * @param {!WebInspector.CSSStyleSheetHeader} header
   */
  _attachSourceMap(header) {
    var sourceMapURL = header.sourceMapURL;
    if (!sourceMapURL || !WebInspector.moduleSetting('cssSourceMapsEnabled').get())
      return;
    if (this._sourceMapByURL.has(sourceMapURL)) {
      attach.call(this, sourceMapURL, header);
      return;
    }
    if (!this._sourceMapLoadingStyleSheetsIds.has(sourceMapURL)) {
      WebInspector.TextSourceMap.load(sourceMapURL, header.sourceURL)
          .then(onTextSourceMapLoaded.bind(this, sourceMapURL))
          .then(onSourceMap.bind(this, sourceMapURL));
    }
    this._sourceMapLoadingStyleSheetsIds.set(sourceMapURL, header.id);

    /**
     * @param {string} sourceMapURL
     * @param {?WebInspector.TextSourceMap} sourceMap
     * @return {!Promise<?WebInspector.SourceMap>}
     * @this {WebInspector.CSSModel}
     */
    function onTextSourceMapLoaded(sourceMapURL, sourceMap) {
      if (!sourceMap)
        return Promise.resolve(/** @type {?WebInspector.SourceMap} */ (null));
      var factoryExtension = this._factoryForSourceMap(sourceMap);
      if (!factoryExtension)
        return Promise.resolve(/** @type {?WebInspector.SourceMap} */ (sourceMap));
      return factoryExtension.instance()
          .then(factory => factory.editableSourceMap(this.target(), sourceMap))
          .then(map => map || sourceMap)
          .catchException(/** @type {?WebInspector.SourceMap} */ (null));
    }

    /**
     * @param {string} sourceMapURL
     * @param {?WebInspector.SourceMap} sourceMap
     * @this {WebInspector.CSSModel}
     */
    function onSourceMap(sourceMapURL, sourceMap) {
      this._sourceMapLoadedForTest();
      var styleSheetIds = this._sourceMapLoadingStyleSheetsIds.get(sourceMapURL);
      this._sourceMapLoadingStyleSheetsIds.removeAll(sourceMapURL);
      if (!sourceMap)
        return;
      var headers = new Set();
      for (var styleSheetId of styleSheetIds) {
        var header = this.styleSheetHeaderForId(styleSheetId);
        if (header)
          headers.add(header);
      }
      if (!headers.size)
        return;
      this._sourceMapByURL.set(sourceMapURL, sourceMap);
      for (var header of headers)
        attach.call(this, sourceMapURL, header);
    }

    /**
     * @param {string} sourceMapURL
     * @param {!WebInspector.CSSStyleSheetHeader} header
     * @this {WebInspector.CSSModel}
     */
    function attach(sourceMapURL, header) {
      this._sourceMapURLToHeaders.set(sourceMapURL, header);
      this.dispatchEventToListeners(WebInspector.CSSModel.Events.SourceMapAttached, header);
    }
  }

  /**
   * @param {!WebInspector.SourceMap} sourceMap
   * @return {?Runtime.Extension}
   */
  _factoryForSourceMap(sourceMap) {
    var sourceExtensions = new Set();
    for (var url of sourceMap.sourceURLs())
      sourceExtensions.add(WebInspector.ParsedURL.extractExtension(url));
    for (var runtimeExtension of self.runtime.extensions(WebInspector.SourceMapFactory)) {
      var supportedExtensions = new Set(runtimeExtension.descriptor()['extensions']);
      if (supportedExtensions.containsAll(sourceExtensions))
        return runtimeExtension;
    }
    return null;
  }

  /**
   * @param {!WebInspector.CSSStyleSheetHeader} header
   */
  _detachSourceMap(header) {
    if (!header.sourceMapURL || !this._sourceMapURLToHeaders.hasValue(header.sourceMapURL, header))
      return;
    this._sourceMapURLToHeaders.remove(header.sourceMapURL, header);
    if (!this._sourceMapURLToHeaders.has(header.sourceMapURL))
      this._sourceMapByURL.delete(header.sourceMapURL);
    this.dispatchEventToListeners(WebInspector.CSSModel.Events.SourceMapDetached, header);
  }

  /**
   * @return {!WebInspector.DOMModel}
   */
  domModel() {
    return this._domModel;
  }

  /**
   * @param {!Protocol.CSS.StyleSheetId} styleSheetId
   * @param {!WebInspector.TextRange} range
   * @param {string} text
   * @param {boolean} majorChange
   * @return {!Promise<boolean>}
   */
  setStyleText(styleSheetId, range, text, majorChange) {
    var original = this._innerSetStyleTexts.bind(this, [styleSheetId], [range], [text], majorChange);
    var header = this.styleSheetHeaderForId(styleSheetId);
    if (!header)
      return original();

    var sourceMap = this.sourceMapForHeader(header);
    if (!sourceMap)
      return original();

    var originalAndDetach = originalAndDetachIfSuccess.bind(this, header);

    if (!sourceMap.editable())
      return original();

    return /** @type {!Promise<boolean>} */ (
        sourceMap.editCompiled([range], [text]).then(onEditingDone.bind(this)).catch(onError.bind(this, header)));

    /**
     * @param {?WebInspector.SourceMap.EditResult} editResult
     * @return {!Promise<boolean>}
     * @this {WebInspector.CSSModel}
     */
    function onEditingDone(editResult) {
      if (!editResult)
        return Promise.resolve(false);

      var edits = editResult.compiledEdits;
      if (!edits.length)
        return onCSSPatched.call(this, editResult, true);

      edits.sort(WebInspector.SourceEdit.comparator);
      edits = edits.reverse();

      var styleSheetIds = [];
      var ranges = [];
      var texts = [];
      for (var edit of edits) {
        styleSheetIds.push(header.id);
        ranges.push(edit.oldRange);
        texts.push(edit.newText);
      }
      return this._innerSetStyleTexts(styleSheetIds, ranges, texts, majorChange)
          .then(onCSSPatched.bind(this, editResult));
    }

    /**
     * @param {!WebInspector.SourceMap.EditResult} editResult
     * @param {boolean} success
     * @return {!Promise<boolean>}
     * @this {WebInspector.CSSModel}
     */
    function onCSSPatched(editResult, success) {
      if (!success)
        return originalAndDetach();

      this._sourceMapByURL.set(header.sourceMapURL, editResult.map);
      this.dispatchEventToListeners(
          WebInspector.CSSModel.Events.SourceMapChanged,
          {sourceMap: editResult.map, newSources: editResult.newSources});
      return Promise.resolve(true);
    }

    /**
     * @param {!WebInspector.CSSStyleSheetHeader} header
     * @param {*} error
     * @return {!Promise<boolean>}
     * @this {WebInspector.CSSModel}
     */
    function onError(header, error) {
      WebInspector.console.error(WebInspector.UIString('LiveSASS failed: %s', sourceMap.compiledURL()));
      console.error(error);
      this._detachSourceMap(header);
      return original();
    }

    /**
     * @param {!WebInspector.CSSStyleSheetHeader} header
     * @return {!Promise<boolean>}
     * @this {WebInspector.CSSModel}
     */
    function originalAndDetachIfSuccess(header) {
      return this._innerSetStyleTexts([styleSheetId], [range], [text], majorChange).then(detachIfSuccess.bind(this));

      /**
       * @param {boolean} success
       * @return {boolean}
       * @this {WebInspector.CSSModel}
       */
      function detachIfSuccess(success) {
        if (success)
          this._detachSourceMap(header);
        return success;
      }
    }
  }

  /**
   * @param {!Array<!Protocol.CSS.StyleSheetId>} styleSheetIds
   * @param {!Array<!WebInspector.TextRange>} ranges
   * @param {!Array<string>} texts
   * @param {boolean} majorChange
   * @return {!Promise<boolean>}
   */
  _innerSetStyleTexts(styleSheetIds, ranges, texts, majorChange) {
    /**
     * @param {?Protocol.Error} error
     * @param {?Array<!Protocol.CSS.CSSStyle>} stylePayloads
     * @return {boolean}
     * @this {WebInspector.CSSModel}
     */
    function parsePayload(error, stylePayloads) {
      if (error || !stylePayloads || stylePayloads.length !== ranges.length)
        return false;

      if (majorChange)
        this._domModel.markUndoableState();
      for (var i = 0; i < ranges.length; ++i) {
        var edit = new WebInspector.CSSModel.Edit(styleSheetIds[i], ranges[i], texts[i], stylePayloads[i]);
        this._fireStyleSheetChanged(styleSheetIds[i], edit);
      }
      return true;
    }

    console.assert(
        styleSheetIds.length === ranges.length && ranges.length === texts.length, 'Array lengths must be equal');
    var edits = [];
    var ensureContentPromises = [];
    for (var i = 0; i < styleSheetIds.length; ++i) {
      edits.push({styleSheetId: styleSheetIds[i], range: ranges[i].serializeToObject(), text: texts[i]});
      ensureContentPromises.push(this._ensureOriginalStyleSheetText(styleSheetIds[i]));
    }

    return Promise.all(ensureContentPromises)
        .then(() => this._agent.setStyleTexts(edits, parsePayload.bind(this)))
        .catchException(false);
  }

  /**
   * @param {!Protocol.CSS.StyleSheetId} styleSheetId
   * @param {!WebInspector.TextRange} range
   * @param {string} text
   * @return {!Promise<boolean>}
   */
  setSelectorText(styleSheetId, range, text) {
    /**
     * @param {?Protocol.Error} error
     * @param {?Protocol.CSS.SelectorList} selectorPayload
     * @return {boolean}
     * @this {WebInspector.CSSModel}
     */
    function callback(error, selectorPayload) {
      if (error || !selectorPayload)
        return false;
      this._domModel.markUndoableState();
      var edit = new WebInspector.CSSModel.Edit(styleSheetId, range, text, selectorPayload);
      this._fireStyleSheetChanged(styleSheetId, edit);
      return true;
    }

    WebInspector.userMetrics.actionTaken(WebInspector.UserMetrics.Action.StyleRuleEdited);
    return this._ensureOriginalStyleSheetText(styleSheetId)
        .then(() => this._agent.setRuleSelector(styleSheetId, range, text, callback.bind(this)))
        .catchException(false);
  }

  /**
   * @param {!Protocol.CSS.StyleSheetId} styleSheetId
   * @param {!WebInspector.TextRange} range
   * @param {string} text
   * @return {!Promise<boolean>}
   */
  setKeyframeKey(styleSheetId, range, text) {
    /**
     * @param {?Protocol.Error} error
     * @param {!Protocol.CSS.Value} payload
     * @return {boolean}
     * @this {WebInspector.CSSModel}
     */
    function callback(error, payload) {
      if (error || !payload)
        return false;
      this._domModel.markUndoableState();
      var edit = new WebInspector.CSSModel.Edit(styleSheetId, range, text, payload);
      this._fireStyleSheetChanged(styleSheetId, edit);
      return true;
    }

    WebInspector.userMetrics.actionTaken(WebInspector.UserMetrics.Action.StyleRuleEdited);
    return this._ensureOriginalStyleSheetText(styleSheetId)
        .then(() => this._agent.setKeyframeKey(styleSheetId, range, text, callback.bind(this)))
        .catchException(false);
  }

  /**
   * @return {!Promise.<!Array.<!WebInspector.CSSMedia>>}
   */
  mediaQueriesPromise() {
    /**
     * @param {?Protocol.Error} error
     * @param {?Array.<!Protocol.CSS.CSSMedia>} payload
     * @return {!Array.<!WebInspector.CSSMedia>}
     * @this {!WebInspector.CSSModel}
     */
    function parsePayload(error, payload) {
      return !error && payload ? WebInspector.CSSMedia.parseMediaArrayPayload(this, payload) : [];
    }

    return this._agent.getMediaQueries(parsePayload.bind(this));
  }

  /**
   * @return {boolean}
   */
  isEnabled() {
    return this._isEnabled;
  }

  /**
   * @param {?Protocol.Error} error
   */
  _wasEnabled(error) {
    if (error) {
      console.error('Failed to enabled CSS agent: ' + error);
      return;
    }
    this._isEnabled = true;
    this.dispatchEventToListeners(WebInspector.CSSModel.Events.ModelWasEnabled);
  }

  /**
   * @param {!Protocol.DOM.NodeId} nodeId
   * @return {!Promise.<?WebInspector.CSSMatchedStyles>}
   */
  matchedStylesPromise(nodeId) {
    /**
     * @param {?Protocol.Error} error
     * @param {?Protocol.CSS.CSSStyle=} inlinePayload
     * @param {?Protocol.CSS.CSSStyle=} attributesPayload
     * @param {!Array.<!Protocol.CSS.RuleMatch>=} matchedPayload
     * @param {!Array.<!Protocol.CSS.PseudoElementMatches>=} pseudoPayload
     * @param {!Array.<!Protocol.CSS.InheritedStyleEntry>=} inheritedPayload
     * @param {!Array.<!Protocol.CSS.CSSKeyframesRule>=} animationsPayload
     * @return {?WebInspector.CSSMatchedStyles}
     * @this {WebInspector.CSSModel}
     */
    function callback(
        error, inlinePayload, attributesPayload, matchedPayload, pseudoPayload, inheritedPayload, animationsPayload) {
      if (error)
        return null;

      var node = this._domModel.nodeForId(nodeId);
      if (!node)
        return null;

      return new WebInspector.CSSMatchedStyles(
          this, node, inlinePayload || null, attributesPayload || null, matchedPayload || [], pseudoPayload || [],
          inheritedPayload || [], animationsPayload || []);
    }

    return this._agent.getMatchedStylesForNode(nodeId, callback.bind(this));
  }

  /**
   * @param {!Protocol.CSS.StyleSheetId} styleSheetId
   * @return {!Promise<!Array<string>>}
   */
  classNamesPromise(styleSheetId) {
    /**
     * @param {?string} error
     * @param {?Array<string>} classNames
     * @return {!Array<string>}
     */
    function classNamesCallback(error, classNames) {
      return !error && classNames ? classNames : [];
    }
    return this._agent.collectClassNames(styleSheetId, classNamesCallback);
  }

  /**
   * @param {!Protocol.DOM.NodeId} nodeId
   * @return {!Promise.<?Map.<string, string>>}
   */
  computedStylePromise(nodeId) {
    return this._styleLoader.computedStylePromise(nodeId);
  }

  /**
   * @param {number} nodeId
   * @return {!Promise<?Array<string>>}
   */
  backgroundColorsPromise(nodeId) {
    /**
     * @param {?string} error
     * @param {!Array<string>=} backgroundColors
     * @return {?Array<string>}
     */
    function backgroundColorsCallback(error, backgroundColors) {
      return !error && backgroundColors ? backgroundColors : null;
    }
    return this._agent.getBackgroundColors(nodeId, backgroundColorsCallback);
  }

  /**
   * @param {number} nodeId
   * @return {!Promise.<?Array.<!Protocol.CSS.PlatformFontUsage>>}
   */
  platformFontsPromise(nodeId) {
    /**
     * @param {?Protocol.Error} error
     * @param {?Array.<!Protocol.CSS.PlatformFontUsage>} fonts
     * @return {?Array.<!Protocol.CSS.PlatformFontUsage>}
     */
    function platformFontsCallback(error, fonts) {
      return !error && fonts ? fonts : null;
    }

    return this._agent.getPlatformFontsForNode(nodeId, platformFontsCallback);
  }

  /**
   * @return {!Array.<!WebInspector.CSSStyleSheetHeader>}
   */
  allStyleSheets() {
    var values = this._styleSheetIdToHeader.valuesArray();
    /**
     * @param {!WebInspector.CSSStyleSheetHeader} a
     * @param {!WebInspector.CSSStyleSheetHeader} b
     * @return {number}
     */
    function styleSheetComparator(a, b) {
      if (a.sourceURL < b.sourceURL)
        return -1;
      else if (a.sourceURL > b.sourceURL)
        return 1;
      return a.startLine - b.startLine || a.startColumn - b.startColumn;
    }
    values.sort(styleSheetComparator);

    return values;
  }

  /**
   * @param {!Protocol.DOM.NodeId} nodeId
   * @return {!Promise.<?WebInspector.CSSModel.InlineStyleResult>}
   */
  inlineStylesPromise(nodeId) {
    /**
     * @param {?Protocol.Error} error
     * @param {?Protocol.CSS.CSSStyle=} inlinePayload
     * @param {?Protocol.CSS.CSSStyle=} attributesStylePayload
     * @return {?WebInspector.CSSModel.InlineStyleResult}
     * @this {WebInspector.CSSModel}
     */
    function callback(error, inlinePayload, attributesStylePayload) {
      if (error || !inlinePayload)
        return null;
      var inlineStyle = inlinePayload ?
          new WebInspector.CSSStyleDeclaration(
              this, null, inlinePayload, WebInspector.CSSStyleDeclaration.Type.Inline) :
          null;
      var attributesStyle = attributesStylePayload ?
          new WebInspector.CSSStyleDeclaration(
              this, null, attributesStylePayload, WebInspector.CSSStyleDeclaration.Type.Attributes) :
          null;
      return new WebInspector.CSSModel.InlineStyleResult(inlineStyle, attributesStyle);
    }

    return this._agent.getInlineStylesForNode(nodeId, callback.bind(this));
  }

  /**
   * @param {!WebInspector.DOMNode} node
   * @param {string} pseudoClass
   * @param {boolean} enable
   * @return {boolean}
   */
  forcePseudoState(node, pseudoClass, enable) {
    var pseudoClasses = node.marker(WebInspector.CSSModel.PseudoStateMarker) || [];
    if (enable) {
      if (pseudoClasses.indexOf(pseudoClass) >= 0)
        return false;
      pseudoClasses.push(pseudoClass);
      node.setMarker(WebInspector.CSSModel.PseudoStateMarker, pseudoClasses);
    } else {
      if (pseudoClasses.indexOf(pseudoClass) < 0)
        return false;
      pseudoClasses.remove(pseudoClass);
      if (pseudoClasses.length)
        node.setMarker(WebInspector.CSSModel.PseudoStateMarker, pseudoClasses);
      else
        node.setMarker(WebInspector.CSSModel.PseudoStateMarker, null);
    }

    this._agent.forcePseudoState(node.id, pseudoClasses);
    this.dispatchEventToListeners(
        WebInspector.CSSModel.Events.PseudoStateForced, {node: node, pseudoClass: pseudoClass, enable: enable});
    return true;
  }

  /**
   * @param {!WebInspector.DOMNode} node
   * @return {?Array<string>} state
   */
  pseudoState(node) {
    return node.marker(WebInspector.CSSModel.PseudoStateMarker) || [];
  }

  /**
   * @param {!Protocol.CSS.StyleSheetId} styleSheetId
   * @param {!WebInspector.TextRange} range
   * @param {string} newMediaText
   * @return {!Promise<boolean>}
   */
  setMediaText(styleSheetId, range, newMediaText) {
    /**
     * @param {?Protocol.Error} error
     * @param {!Protocol.CSS.CSSMedia} mediaPayload
     * @return {boolean}
     * @this {WebInspector.CSSModel}
     */
    function parsePayload(error, mediaPayload) {
      if (!mediaPayload)
        return false;
      this._domModel.markUndoableState();
      var edit = new WebInspector.CSSModel.Edit(styleSheetId, range, newMediaText, mediaPayload);
      this._fireStyleSheetChanged(styleSheetId, edit);
      return true;
    }

    WebInspector.userMetrics.actionTaken(WebInspector.UserMetrics.Action.StyleRuleEdited);
    return this._ensureOriginalStyleSheetText(styleSheetId)
        .then(() => this._agent.setMediaText(styleSheetId, range, newMediaText, parsePayload.bind(this)))
        .catchException(false);
  }

  /**
   * @param {!Protocol.CSS.StyleSheetId} styleSheetId
   * @param {string} ruleText
   * @param {!WebInspector.TextRange} ruleLocation
   * @return {!Promise<?WebInspector.CSSStyleRule>}
   */
  addRule(styleSheetId, ruleText, ruleLocation) {
    return this._ensureOriginalStyleSheetText(styleSheetId)
        .then(() => this._agent.addRule(styleSheetId, ruleText, ruleLocation, parsePayload.bind(this)))
        .catchException(/** @type {?WebInspector.CSSStyleRule} */ (null));

    /**
     * @param {?Protocol.Error} error
     * @param {?Protocol.CSS.CSSRule} rulePayload
     * @return {?WebInspector.CSSStyleRule}
     * @this {WebInspector.CSSModel}
     */
    function parsePayload(error, rulePayload) {
      if (error || !rulePayload)
        return null;
      this._domModel.markUndoableState();
      var edit = new WebInspector.CSSModel.Edit(styleSheetId, ruleLocation, ruleText, rulePayload);
      this._fireStyleSheetChanged(styleSheetId, edit);
      return new WebInspector.CSSStyleRule(this, rulePayload);
    }
  }

  /**
   * @param {!WebInspector.DOMNode} node
   * @param {function(?WebInspector.CSSStyleSheetHeader)} userCallback
   */
  requestViaInspectorStylesheet(node, userCallback) {
    var frameId = node.frameId() || WebInspector.ResourceTreeModel.fromTarget(this.target()).mainFrame.id;
    var headers = this._styleSheetIdToHeader.valuesArray();
    for (var i = 0; i < headers.length; ++i) {
      var styleSheetHeader = headers[i];
      if (styleSheetHeader.frameId === frameId && styleSheetHeader.isViaInspector()) {
        userCallback(styleSheetHeader);
        return;
      }
    }

    /**
     * @param {?Protocol.Error} error
     * @param {?Protocol.CSS.StyleSheetId} styleSheetId
     * @return {?WebInspector.CSSStyleSheetHeader}
     * @this {WebInspector.CSSModel}
     */
    function innerCallback(error, styleSheetId) {
      return !error && styleSheetId ? this._styleSheetIdToHeader.get(styleSheetId) || null : null;
    }

    this._agent.createStyleSheet(frameId, innerCallback.bind(this)).catchException(null).then(userCallback);
  }

  mediaQueryResultChanged() {
    this.dispatchEventToListeners(WebInspector.CSSModel.Events.MediaQueryResultChanged);
  }

  fontsUpdated() {
    this.dispatchEventToListeners(WebInspector.CSSModel.Events.FontsUpdated);
  }

  /**
   * @param {!Protocol.CSS.StyleSheetId} id
   * @return {?WebInspector.CSSStyleSheetHeader}
   */
  styleSheetHeaderForId(id) {
    return this._styleSheetIdToHeader.get(id) || null;
  }

  /**
   * @return {!Array.<!WebInspector.CSSStyleSheetHeader>}
   */
  styleSheetHeaders() {
    return this._styleSheetIdToHeader.valuesArray();
  }

  /**
   * @param {!Protocol.CSS.StyleSheetId} styleSheetId
   * @param {!WebInspector.CSSModel.Edit=} edit
   */
  _fireStyleSheetChanged(styleSheetId, edit) {
    this.dispatchEventToListeners(
        WebInspector.CSSModel.Events.StyleSheetChanged, {styleSheetId: styleSheetId, edit: edit});
  }

  /**
   * @param {!Protocol.CSS.StyleSheetId} styleSheetId
   * @return {!Promise<string>}
   */
  _ensureOriginalStyleSheetText(styleSheetId) {
    var header = this.styleSheetHeaderForId(styleSheetId);
    if (!header)
      return Promise.resolve('');
    var promise = this._originalStyleSheetText.get(header);
    if (!promise) {
      promise = this.getStyleSheetText(header.id);
      this._originalStyleSheetText.set(header, promise);
      this._originalContentRequestedForTest(header);
    }
    return promise;
  }

  /**
   * @param {!WebInspector.CSSStyleSheetHeader} header
   */
  _originalContentRequestedForTest(header) {
  }

  /**
   * @param {!WebInspector.CSSStyleSheetHeader} header
   * @return {!Promise<string>}
   */
  originalStyleSheetText(header) {
    return this._ensureOriginalStyleSheetText(header.id);
  }

  /**
   * @param {!Protocol.CSS.CSSStyleSheetHeader} header
   */
  _styleSheetAdded(header) {
    console.assert(!this._styleSheetIdToHeader.get(header.styleSheetId));
    var styleSheetHeader = new WebInspector.CSSStyleSheetHeader(this, header);
    this._styleSheetIdToHeader.set(header.styleSheetId, styleSheetHeader);
    var url = styleSheetHeader.resourceURL();
    if (!this._styleSheetIdsForURL.get(url))
      this._styleSheetIdsForURL.set(url, {});
    var frameIdToStyleSheetIds = this._styleSheetIdsForURL.get(url);
    var styleSheetIds = frameIdToStyleSheetIds[styleSheetHeader.frameId];
    if (!styleSheetIds) {
      styleSheetIds = [];
      frameIdToStyleSheetIds[styleSheetHeader.frameId] = styleSheetIds;
    }
    styleSheetIds.push(styleSheetHeader.id);
    this._attachSourceMap(styleSheetHeader);
    this.dispatchEventToListeners(WebInspector.CSSModel.Events.StyleSheetAdded, styleSheetHeader);
  }

  /**
   * @param {!Protocol.CSS.StyleSheetId} id
   */
  _styleSheetRemoved(id) {
    var header = this._styleSheetIdToHeader.get(id);
    console.assert(header);
    if (!header)
      return;
    this._styleSheetIdToHeader.remove(id);
    var url = header.resourceURL();
    var frameIdToStyleSheetIds = /** @type {!Object.<!Protocol.Page.FrameId, !Array.<!Protocol.CSS.StyleSheetId>>} */ (
        this._styleSheetIdsForURL.get(url));
    console.assert(frameIdToStyleSheetIds, 'No frameId to styleSheetId map is available for given style sheet URL.');
    frameIdToStyleSheetIds[header.frameId].remove(id);
    if (!frameIdToStyleSheetIds[header.frameId].length) {
      delete frameIdToStyleSheetIds[header.frameId];
      if (!Object.keys(frameIdToStyleSheetIds).length)
        this._styleSheetIdsForURL.remove(url);
    }
    this._originalStyleSheetText.remove(header);
    this._detachSourceMap(header);
    this.dispatchEventToListeners(WebInspector.CSSModel.Events.StyleSheetRemoved, header);
  }

  /**
   * @param {string} url
   * @return {!Array.<!Protocol.CSS.StyleSheetId>}
   */
  styleSheetIdsForURL(url) {
    var frameIdToStyleSheetIds = this._styleSheetIdsForURL.get(url);
    if (!frameIdToStyleSheetIds)
      return [];

    var result = [];
    for (var frameId in frameIdToStyleSheetIds)
      result = result.concat(frameIdToStyleSheetIds[frameId]);
    return result;
  }

  /**
   * @param {!Protocol.CSS.StyleSheetId} styleSheetId
   * @param {string} newText
   * @param {boolean} majorChange
   * @return {!Promise.<?Protocol.Error>}
   */
  setStyleSheetText(styleSheetId, newText, majorChange) {
    var header = /** @type {!WebInspector.CSSStyleSheetHeader} */ (this._styleSheetIdToHeader.get(styleSheetId));
    console.assert(header);
    newText = WebInspector.CSSModel.trimSourceURL(newText);
    if (header.hasSourceURL)
      newText += '\n/*# sourceURL=' + header.sourceURL + ' */';
    return this._ensureOriginalStyleSheetText(styleSheetId)
        .then(() => this._agent.setStyleSheetText(header.id, newText, callback.bind(this)));

    /**
     * @param {?Protocol.Error} error
     * @param {string=} sourceMapURL
     * @return {?Protocol.Error}
     * @this {WebInspector.CSSModel}
     */
    function callback(error, sourceMapURL) {
      this._detachSourceMap(header);
      header.setSourceMapURL(sourceMapURL);
      this._attachSourceMap(header);
      if (error)
        return error;
      if (majorChange)
        this._domModel.markUndoableState();
      this._fireStyleSheetChanged(styleSheetId);
      return null;
    }
  }

  /**
   * @param {!Protocol.CSS.StyleSheetId} styleSheetId
   * @return {!Promise<string>}
   */
  getStyleSheetText(styleSheetId) {
    /**
     * @param {?Protocol.Error} error
     * @param {?string} text
     * @return {string}
     */
    function textCallback(error, text) {
      if (error || text === null) {
        console.error('Failed to get text for stylesheet ' + styleSheetId + ': ' + error);
        text = '';
        // Fall through.
      }
      return WebInspector.CSSModel.trimSourceURL(text);
    }

    return this._agent.getStyleSheetText(styleSheetId, textCallback).catchException(/** @type {string} */ (''));
  }

  /**
   * @param {!WebInspector.Event} event
   */
  _mainFrameNavigated(event) {
    if (event.data.target() !== this.target())
      return;
    this._resetStyleSheets();
  }

  _resetStyleSheets() {
    var headers = this._styleSheetIdToHeader.valuesArray();
    this._styleSheetIdsForURL.clear();
    this._styleSheetIdToHeader.clear();
    for (var i = 0; i < headers.length; ++i) {
      this._detachSourceMap(headers[i]);
      this.dispatchEventToListeners(WebInspector.CSSModel.Events.StyleSheetRemoved, headers[i]);
    }
    this._sourceMapByURL.clear();
    this._sourceMapURLToHeaders.clear();
    this._sourceMapLoadingStyleSheetsIds.clear();
  }

  /**
   * @override
   * @return {!Promise}
   */
  suspendModel() {
    this._isEnabled = false;
    return this._agent.disable().then(this._resetStyleSheets.bind(this));
  }

  /**
   * @override
   * @return {!Promise}
   */
  resumeModel() {
    return this._agent.enable().then(this._wasEnabled.bind(this));
  }

  /**
   * @param {!Protocol.CSS.StyleSheetId} id
   * @param {!Protocol.CSS.SourceRange} range
   */
  _layoutEditorChange(id, range) {
    this.dispatchEventToListeners(WebInspector.CSSModel.Events.LayoutEditorChange, {id: id, range: range});
  }

  /**
   * @param {number} nodeId
   * @param {string} name
   * @param {string} value
   */
  setEffectivePropertyValueForNode(nodeId, name, value) {
    this._agent.setEffectivePropertyValueForNode(nodeId, name, value);
  }

  /**
   * @param {!WebInspector.DOMNode} node
   * @return {!Promise.<?WebInspector.CSSMatchedStyles>}
   */
  cachedMatchedCascadeForNode(node) {
    if (this._cachedMatchedCascadeNode !== node)
      this.discardCachedMatchedCascade();
    this._cachedMatchedCascadeNode = node;
    if (!this._cachedMatchedCascadePromise)
      this._cachedMatchedCascadePromise = this.matchedStylesPromise(node.id);
    return this._cachedMatchedCascadePromise;
  }

  discardCachedMatchedCascade() {
    delete this._cachedMatchedCascadeNode;
    delete this._cachedMatchedCascadePromise;
  }
};

/** @enum {symbol} */
WebInspector.CSSModel.Events = {
  LayoutEditorChange: Symbol('LayoutEditorChange'),
  FontsUpdated: Symbol('FontsUpdated'),
  MediaQueryResultChanged: Symbol('MediaQueryResultChanged'),
  ModelWasEnabled: Symbol('ModelWasEnabled'),
  PseudoStateForced: Symbol('PseudoStateForced'),
  StyleSheetAdded: Symbol('StyleSheetAdded'),
  StyleSheetChanged: Symbol('StyleSheetChanged'),
  StyleSheetRemoved: Symbol('StyleSheetRemoved'),
  SourceMapAttached: Symbol('SourceMapAttached'),
  SourceMapDetached: Symbol('SourceMapDetached'),
  SourceMapChanged: Symbol('SourceMapChanged')
};

WebInspector.CSSModel.MediaTypes =
    ['all', 'braille', 'embossed', 'handheld', 'print', 'projection', 'screen', 'speech', 'tty', 'tv'];

WebInspector.CSSModel.PseudoStateMarker = 'pseudo-state-marker';

/**
 * @unrestricted
 */
WebInspector.CSSModel.Edit = class {
  /**
   * @param {!Protocol.CSS.StyleSheetId} styleSheetId
   * @param {!WebInspector.TextRange} oldRange
   * @param {string} newText
   * @param {?Object} payload
   */
  constructor(styleSheetId, oldRange, newText, payload) {
    this.styleSheetId = styleSheetId;
    this.oldRange = oldRange;
    this.newRange = WebInspector.TextRange.fromEdit(oldRange, newText);
    this.payload = payload;
  }
};


/**
 * @unrestricted
 */
WebInspector.CSSLocation = class extends WebInspector.SDKObject {
  /**
   * @param {!WebInspector.CSSStyleSheetHeader} header
   * @param {number} lineNumber
   * @param {number=} columnNumber
   */
  constructor(header, lineNumber, columnNumber) {
    super(header.target());
    this._header = header;
    this.styleSheetId = header.id;
    this.url = header.resourceURL();
    this.lineNumber = lineNumber;
    this.columnNumber = columnNumber || 0;
  }

  /**
   * @return {!WebInspector.CSSModel}
   */
  cssModel() {
    return this._header.cssModel();
  }

  /**
   * @return {!WebInspector.CSSStyleSheetHeader}
   */
  header() {
    return this._header;
  }
};

/**
 * @implements {Protocol.CSSDispatcher}
 * @unrestricted
 */
WebInspector.CSSDispatcher = class {
  /**
   * @param {!WebInspector.CSSModel} cssModel
   */
  constructor(cssModel) {
    this._cssModel = cssModel;
  }

  /**
   * @override
   */
  mediaQueryResultChanged() {
    this._cssModel.mediaQueryResultChanged();
  }

  /**
   * @override
   */
  fontsUpdated() {
    this._cssModel.fontsUpdated();
  }

  /**
   * @override
   * @param {!Protocol.CSS.StyleSheetId} styleSheetId
   */
  styleSheetChanged(styleSheetId) {
    this._cssModel._fireStyleSheetChanged(styleSheetId);
  }

  /**
   * @override
   * @param {!Protocol.CSS.CSSStyleSheetHeader} header
   */
  styleSheetAdded(header) {
    this._cssModel._styleSheetAdded(header);
  }

  /**
   * @override
   * @param {!Protocol.CSS.StyleSheetId} id
   */
  styleSheetRemoved(id) {
    this._cssModel._styleSheetRemoved(id);
  }

  /**
   * @override
   * @param {!Protocol.CSS.StyleSheetId} id
   * @param {!Protocol.CSS.SourceRange} range
   */
  layoutEditorChange(id, range) {
    this._cssModel._layoutEditorChange(id, range);
  }
};

/**
 * @unrestricted
 */
WebInspector.CSSModel.ComputedStyleLoader = class {
  /**
   * @param {!WebInspector.CSSModel} cssModel
   */
  constructor(cssModel) {
    this._cssModel = cssModel;
    /** @type {!Map<!Protocol.DOM.NodeId, !Promise<?Map<string, string>>>} */
    this._nodeIdToPromise = new Map();
  }

  /**
   * @param {!Protocol.DOM.NodeId} nodeId
   * @return {!Promise<?Map<string, string>>}
   */
  computedStylePromise(nodeId) {
    if (!this._nodeIdToPromise.has(nodeId))
      this._nodeIdToPromise.set(
          nodeId, this._cssModel._agent.getComputedStyleForNode(nodeId, parsePayload).then(cleanUp.bind(this)));

    return /** @type {!Promise.<?Map.<string, string>>} */ (this._nodeIdToPromise.get(nodeId));

    /**
     * @param {?Protocol.Error} error
     * @param {!Array.<!Protocol.CSS.CSSComputedStyleProperty>} computedPayload
     * @return {?Map.<string, string>}
     */
    function parsePayload(error, computedPayload) {
      if (error || !computedPayload || !computedPayload.length)
        return null;
      var result = new Map();
      for (var property of computedPayload)
        result.set(property.name, property.value);
      return result;
    }

    /**
     * @param {?Map.<string, string>} computedStyle
     * @return {?Map.<string, string>}
     * @this {WebInspector.CSSModel.ComputedStyleLoader}
     */
    function cleanUp(computedStyle) {
      this._nodeIdToPromise.delete(nodeId);
      return computedStyle;
    }
  }
};


/**
 * @unrestricted
 */
WebInspector.CSSModel.InlineStyleResult = class {
  /**
   * @param {?WebInspector.CSSStyleDeclaration} inlineStyle
   * @param {?WebInspector.CSSStyleDeclaration} attributesStyle
   */
  constructor(inlineStyle, attributesStyle) {
    this.inlineStyle = inlineStyle;
    this.attributesStyle = attributesStyle;
  }
};