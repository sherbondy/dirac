// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

Resources.StorageItemsView = class extends UI.VBox {
  /**
   * @param {string} title
   * @param {string} filterName
   */
  constructor(title, filterName) {
    super(false);
    /** @type {?RegExp} */
    this._filterRegex = null;

    this._filterBar = new UI.FilterBar(filterName, true);
    this._textFilterUI = new UI.TextFilterUI(false);
    this._textFilterUI.addEventListener(UI.FilterUI.Events.FilterChanged, this._filterChanged, this);
    this._filterBar.addFilter(this._textFilterUI);

    this._deleteAllButton = this._addButton(Common.UIString('Clear All'), 'largeicon-clear', this.deleteAllItems);
    this._deleteSelectedButton =
        this._addButton(Common.UIString('Delete Selected'), 'largeicon-delete', this.deleteSelectedItem);
    this._refreshButton = this._addButton(Common.UIString('Refresh'), 'largeicon-refresh', this.refreshItems);
    this._filterButton = this._filterBar.filterButton();

    this._mainToolbar = new UI.Toolbar('top-resources-toolbar', this.element);

    var toolbarItems = [
      this._refreshButton, this._deleteAllButton, this._deleteSelectedButton, new UI.ToolbarSeparator(),
      this._filterButton
    ];

    this.element.addEventListener('contextmenu', this._showContextMenu.bind(this), true);

    for (var item of toolbarItems)
      this._mainToolbar.appendToolbarItem(item);

    this._filterBar.show(this.element);
  }

  /**
   * @param {string} label
   * @param {string} glyph
   * @param {!Function} callback
   * @return {!UI.ToolbarButton}
   */
  _addButton(label, glyph, callback) {
    var button = new UI.ToolbarButton(label, glyph);
    button.addEventListener(UI.ToolbarButton.Events.Click, callback, this);
    return button;
  }

  /**
   * @param {!Event} event
   */
  _showContextMenu(event) {
    var contextMenu = new UI.ContextMenu(event);
    contextMenu.appendItem(Common.UIString('Refresh'), this.refreshItems.bind(this));
    contextMenu.show();
  }


  /**
   * @param {!Common.Event} event
   */
  _filterChanged(event) {
    var text = this._textFilterUI.value();
    this._filterRegex = text ? new RegExp(text.escapeForRegExp(), 'i') : null;
    this.refreshItems();
  }

  /**
   * @param {!Array<?Object>} items
   * @param {function(?Object): string} keyFunction
   * @return {!Array<?Object>}
   * @protected
   */
  filter(items, keyFunction) {
    if (!this._filterRegex)
      return items;
    return items.filter(item => this._filterRegex.test(keyFunction(item)));
  }

  /**
   * @override
   */
  wasShown() {
    this.refreshItems();
  }

  /**
   * @override
   */
  willHide() {
    this.setCanDeleteSelected(false);
  }

  /**
   * @param {boolean} enabled
   * @protected
   */
  setCanDeleteAll(enabled) {
    this._deleteAllButton.setEnabled(enabled);
  }

  /**
   * @param {boolean} enabled
   * @protected
   */
  setCanDeleteSelected(enabled) {
    this._deleteSelectedButton.setEnabled(enabled);
  }

  /**
   * @param {boolean} enabled
   * @protected
   */
  setCanRefresh(enabled) {
    this._refreshButton.setEnabled(enabled);
  }

  /**
   * @param {boolean} enabled
   * @protected
   */
  setCanFilter(enabled) {
    this._filterButton.setEnabled(enabled);
  }

  deleteAllItems() {
  }

  deleteSelectedItem() {
  }

  refreshItems() {
  }
};