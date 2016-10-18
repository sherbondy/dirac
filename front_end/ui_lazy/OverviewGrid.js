/*
 * Copyright (C) 2013 Google Inc. All rights reserved.
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
 * @constructor
 * @param {string} prefix
 */
WebInspector.OverviewGrid = function(prefix)
{
    this.element = createElement("div");
    this.element.id = prefix + "-overview-container";

    this._grid = new WebInspector.TimelineGrid();
    this._grid.element.id = prefix + "-overview-grid";
    this._grid.setScrollTop(0);

    this.element.appendChild(this._grid.element);

    this._window = new WebInspector.OverviewGrid.Window(this.element, this._grid.dividersLabelBarElement);
}

WebInspector.OverviewGrid.prototype = {
    /**
     * @return {number}
     */
    clientWidth: function()
    {
        return this.element.clientWidth;
    },

    /**
     * @param {!WebInspector.TimelineGrid.Calculator} calculator
     */
    updateDividers: function(calculator)
    {
        this._grid.updateDividers(calculator);
    },

    /**
     * @param {!Array.<!Element>} dividers
     */
    addEventDividers: function(dividers)
    {
        this._grid.addEventDividers(dividers);
    },

    removeEventDividers: function()
    {
        this._grid.removeEventDividers();
    },

    reset: function()
    {
        this._window.reset();
    },

    /**
     * @return {number}
     */
    windowLeft: function()
    {
        return this._window.windowLeft;
    },

    /**
     * @return {number}
     */
    windowRight: function()
    {
        return this._window.windowRight;
    },

    /**
     * @param {number} left
     * @param {number} right
     */
    setWindow: function(left, right)
    {
        this._window._setWindow(left, right);
    },

    /**
     * @param {string} eventType
     * @param {function(!WebInspector.Event)} listener
     * @param {!Object=} thisObject
     * @return {!WebInspector.EventTarget.EventDescriptor}
     */
    addEventListener: function(eventType, listener, thisObject)
    {
        return this._window.addEventListener(eventType, listener, thisObject);
    },

    /**
     * @param {number} zoomFactor
     * @param {number} referencePoint
     */
    zoom: function(zoomFactor, referencePoint)
    {
        this._window._zoom(zoomFactor, referencePoint);
    },

    /**
     * @param {boolean} enabled
     */
    setResizeEnabled: function(enabled)
    {
        this._window.setEnabled(enabled);
    }
}


WebInspector.OverviewGrid.MinSelectableSize = 14;

WebInspector.OverviewGrid.WindowScrollSpeedFactor = .3;

WebInspector.OverviewGrid.ResizerOffset = 3.5; // half pixel because offset values are not rounded but ceiled

/**
 * @constructor
 * @extends {WebInspector.Object}
 * @param {!Element} parentElement
 * @param {!Element=} dividersLabelBarElement
 */
WebInspector.OverviewGrid.Window = function(parentElement, dividersLabelBarElement)
{
    this._parentElement = parentElement;

    WebInspector.installDragHandle(this._parentElement, this._startWindowSelectorDragging.bind(this), this._windowSelectorDragging.bind(this), this._endWindowSelectorDragging.bind(this), "text", null);
    if (dividersLabelBarElement)
        WebInspector.installDragHandle(dividersLabelBarElement, this._startWindowDragging.bind(this), this._windowDragging.bind(this), null, "-webkit-grabbing", "-webkit-grab");

    this._parentElement.addEventListener("mousewheel", this._onMouseWheel.bind(this), true);
    this._parentElement.addEventListener("dblclick", this._resizeWindowMaximum.bind(this), true);
    WebInspector.appendStyle(this._parentElement, "ui_lazy/overviewGrid.css");

    this._leftResizeElement = parentElement.createChild("div", "overview-grid-window-resizer");
    WebInspector.installDragHandle(this._leftResizeElement, this._resizerElementStartDragging.bind(this), this._leftResizeElementDragging.bind(this), null, "ew-resize");
    this._rightResizeElement = parentElement.createChild("div", "overview-grid-window-resizer");
    WebInspector.installDragHandle(this._rightResizeElement, this._resizerElementStartDragging.bind(this), this._rightResizeElementDragging.bind(this), null, "ew-resize");

    this._leftCurtainElement = parentElement.createChild("div", "window-curtain-left");
    this._rightCurtainElement = parentElement.createChild("div", "window-curtain-right");
    this.reset();
}

/** @enum {symbol} */
WebInspector.OverviewGrid.Events = {
    WindowChanged: Symbol("WindowChanged"),
    Click: Symbol("Click")
}

WebInspector.OverviewGrid.Window.prototype = {
    reset: function()
    {
        this.windowLeft = 0.0;
        this.windowRight = 1.0;
        this.setEnabled(true);
        this._updateCurtains();
    },

    /**
     * @param {boolean} enabled
     */
    setEnabled: function(enabled)
    {
        this._enabled = enabled;
    },

    /**
     * @param {!Event} event
     */
    _resizerElementStartDragging: function(event)
    {
        if (!this._enabled)
            return false;
        this._resizerParentOffsetLeft = event.pageX - event.offsetX - event.target.offsetLeft;
        event.preventDefault();
        return true;
    },

    /**
     * @param {!Event} event
     */
    _leftResizeElementDragging: function(event)
    {
        this._resizeWindowLeft(event.pageX - this._resizerParentOffsetLeft);
        event.preventDefault();
    },

    /**
     * @param {!Event} event
     */
    _rightResizeElementDragging: function(event)
    {
        this._resizeWindowRight(event.pageX - this._resizerParentOffsetLeft);
        event.preventDefault();
    },

    /**
     * @param {!Event} event
     * @return {boolean}
     */
    _startWindowSelectorDragging: function(event)
    {
        if (!this._enabled)
            return false;
        this._offsetLeft = this._parentElement.totalOffsetLeft();
        var position = event.x - this._offsetLeft;
        this._overviewWindowSelector = new WebInspector.OverviewGrid.WindowSelector(this._parentElement, position);
        return true;
    },

    /**
     * @param {!Event} event
     */
    _windowSelectorDragging: function(event)
    {
        this._overviewWindowSelector._updatePosition(event.x - this._offsetLeft);
        event.preventDefault();
    },

    /**
     * @param {!Event} event
     */
    _endWindowSelectorDragging: function(event)
    {
        var window = this._overviewWindowSelector._close(event.x - this._offsetLeft);
        delete this._overviewWindowSelector;
        var clickThreshold = 3;
        if (window.end - window.start < clickThreshold) {
            if (this.dispatchEventToListeners(WebInspector.OverviewGrid.Events.Click, event))
                return;
            var middle = window.end;
            window.start = Math.max(0, middle - WebInspector.OverviewGrid.MinSelectableSize / 2);
            window.end = Math.min(this._parentElement.clientWidth, middle + WebInspector.OverviewGrid.MinSelectableSize / 2);
        } else if (window.end - window.start < WebInspector.OverviewGrid.MinSelectableSize) {
            if (this._parentElement.clientWidth - window.end > WebInspector.OverviewGrid.MinSelectableSize)
                window.end = window.start + WebInspector.OverviewGrid.MinSelectableSize;
            else
                window.start = window.end - WebInspector.OverviewGrid.MinSelectableSize;
        }
        this._setWindowPosition(window.start, window.end);
    },

    /**
     * @param {!Event} event
     * @return {boolean}
     */
    _startWindowDragging: function(event)
    {
        this._dragStartPoint = event.pageX;
        this._dragStartLeft = this.windowLeft;
        this._dragStartRight = this.windowRight;
        return true;
    },

    /**
     * @param {!Event} event
     */
    _windowDragging: function(event)
    {
        event.preventDefault();
        var delta = (event.pageX - this._dragStartPoint) / this._parentElement.clientWidth;
        if (this._dragStartLeft + delta < 0)
            delta = -this._dragStartLeft;

        if (this._dragStartRight + delta > 1)
            delta = 1 - this._dragStartRight;

        this._setWindow(this._dragStartLeft + delta, this._dragStartRight + delta);
    },

    /**
     * @param {number} start
     */
    _resizeWindowLeft: function(start)
    {
        // Glue to edge.
        if (start < 10)
            start = 0;
        else if (start > this._rightResizeElement.offsetLeft -  4)
            start = this._rightResizeElement.offsetLeft - 4;
        this._setWindowPosition(start, null);
    },

    /**
     * @param {number} end
     */
    _resizeWindowRight: function(end)
    {
        // Glue to edge.
        if (end > this._parentElement.clientWidth - 10)
            end = this._parentElement.clientWidth;
        else if (end < this._leftResizeElement.offsetLeft + WebInspector.OverviewGrid.MinSelectableSize)
            end = this._leftResizeElement.offsetLeft + WebInspector.OverviewGrid.MinSelectableSize;
        this._setWindowPosition(null, end);
    },

    _resizeWindowMaximum: function()
    {
        this._setWindowPosition(0, this._parentElement.clientWidth);
    },

    /**
     * @param {number} windowLeft
     * @param {number} windowRight
     */
    _setWindow: function(windowLeft, windowRight)
    {
        this.windowLeft = windowLeft;
        this.windowRight = windowRight;
        this._updateCurtains();
        this.dispatchEventToListeners(WebInspector.OverviewGrid.Events.WindowChanged);
    },

    _updateCurtains: function()
    {
        var left = this.windowLeft;
        var right = this.windowRight;
        var width = right - left;

        // We allow actual time window to be arbitrarily small but don't want the UI window to be too small.
        var widthInPixels = width * this._parentElement.clientWidth;
        var minWidthInPixels = WebInspector.OverviewGrid.MinSelectableSize / 2;
        if (widthInPixels < minWidthInPixels) {
            var factor = minWidthInPixels / widthInPixels;
            left = ((this.windowRight + this.windowLeft) - width * factor) / 2;
            right = ((this.windowRight + this.windowLeft) + width * factor) / 2;
        }
        this._leftResizeElement.style.left = (100 * left).toFixed(2) + "%";
        this._rightResizeElement.style.left = (100 * right).toFixed(2) + "%";

        this._leftCurtainElement.style.width = (100 * left).toFixed(2) + "%";
        this._rightCurtainElement.style.width = (100 * (1 - right)).toFixed(2) + "%";
    },

    /**
     * @param {?number} start
     * @param {?number} end
     */
    _setWindowPosition: function(start, end)
    {
        var clientWidth = this._parentElement.clientWidth;
        var windowLeft = typeof start === "number" ? start / clientWidth : this.windowLeft;
        var windowRight = typeof end === "number" ? end / clientWidth : this.windowRight;
        this._setWindow(windowLeft, windowRight);
    },

    /**
     * @param {!Event} event
     */
    _onMouseWheel: function(event)
    {
        if (!this._enabled)
            return;
        if (typeof event.wheelDeltaY === "number" && event.wheelDeltaY) {
            const zoomFactor = 1.1;
            const mouseWheelZoomSpeed = 1 / 120;

            var reference = event.offsetX / event.target.clientWidth;
            this._zoom(Math.pow(zoomFactor, -event.wheelDeltaY * mouseWheelZoomSpeed), reference);
        }
        if (typeof event.wheelDeltaX === "number" && event.wheelDeltaX) {
            var offset = Math.round(event.wheelDeltaX * WebInspector.OverviewGrid.WindowScrollSpeedFactor);
            var windowLeft = this._leftResizeElement.offsetLeft + WebInspector.OverviewGrid.ResizerOffset;
            var windowRight = this._rightResizeElement.offsetLeft + WebInspector.OverviewGrid.ResizerOffset;

            if (windowLeft - offset < 0)
                offset = windowLeft;

            if (windowRight - offset > this._parentElement.clientWidth)
                offset = windowRight - this._parentElement.clientWidth;

            this._setWindowPosition(windowLeft - offset, windowRight - offset);

            event.preventDefault();
        }
    },

    /**
     * @param {number} factor
     * @param {number} reference
     */
    _zoom: function(factor, reference)
    {
        var left = this.windowLeft;
        var right = this.windowRight;
        var windowSize = right - left;
        var newWindowSize = factor * windowSize;
        if (newWindowSize > 1) {
            newWindowSize = 1;
            factor = newWindowSize / windowSize;
        }
        left = reference + (left - reference) * factor;
        left = Number.constrain(left, 0, 1 - newWindowSize);

        right = reference + (right - reference) * factor;
        right = Number.constrain(right, newWindowSize, 1);
        this._setWindow(left, right);
    },

    __proto__: WebInspector.Object.prototype
}

/**
 * @constructor
 */
WebInspector.OverviewGrid.WindowSelector = function(parent, position)
{
    this._startPosition = position;
    this._width = parent.offsetWidth;
    this._windowSelector = createElement("div");
    this._windowSelector.className = "overview-grid-window-selector";
    this._windowSelector.style.left = this._startPosition + "px";
    this._windowSelector.style.right = this._width - this._startPosition + "px";
    parent.appendChild(this._windowSelector);
}

WebInspector.OverviewGrid.WindowSelector.prototype = {
    _close: function(position)
    {
        position = Math.max(0, Math.min(position, this._width));
        this._windowSelector.remove();
        return this._startPosition < position ? {start: this._startPosition, end: position} : {start: position, end: this._startPosition};
    },

    _updatePosition: function(position)
    {
        position = Math.max(0, Math.min(position, this._width));
        if (position < this._startPosition) {
            this._windowSelector.style.left = position + "px";
            this._windowSelector.style.right = this._width - this._startPosition + "px";
        } else {
            this._windowSelector.style.left = this._startPosition + "px";
            this._windowSelector.style.right = this._width - position + "px";
        }
    }
}