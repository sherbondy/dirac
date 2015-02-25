// Copyright (c) 2015 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * @constructor
 * @extends {WebInspector.VBox}
 * @param {!WebInspector.StylesSidebarPane} stylesPane
 */
WebInspector.AnimationTimeline = function(stylesPane)
{
    WebInspector.VBox.call(this, true);
    this._stylesPane = stylesPane;
    this.registerRequiredCSS("elements/animationTimeline.css");
    this.element.classList.add("animations-timeline");

    this._grid = this.contentElement.createSVGChild("svg", "animation-timeline-grid");
    this._timelineScrubber = this.contentElement.createChild("div", "animation-scrubber");
    this._timelineScrubber.createChild("div", "animation-time-overlay");
    this._timelineScrubber.createChild("div", "animation-scrubber-arrow");
    this._timelineScrubberHead = this._timelineScrubber.createChild("div", "animation-scrubber-head");
    WebInspector.installDragHandle(this._timelineScrubberHead, this._scrubberDragStart.bind(this), this._scrubberDragMove.bind(this), this._scrubberDragEnd.bind(this), "move");
    this._timelineScrubberHead.textContent = WebInspector.UIString(Number.millisToString(0));

    this.contentElement.appendChild(this._createHeader());
    this._animationsContainer = this.contentElement.createChild("div");
    this._animations = [];
    this._uiAnimations = [];
    this._duration = this._defaultDuration();

    this._scrubberRadius = 25;

    WebInspector.targetManager.addModelListener(WebInspector.ResourceTreeModel, WebInspector.ResourceTreeModel.EventTypes.MainFrameNavigated, this._mainFrameNavigated, this);
}

WebInspector.AnimationTimeline.prototype = {
    _createHeader: function()
    {
        /**
         * @param {!Event} event
         * @this {WebInspector.AnimationTimeline}
         */
        function playbackSliderInputHandler(event)
        {
            this._animationsPlaybackRate = WebInspector.AnimationsSidebarPane.GlobalPlaybackRates[event.target.value];
            var target = WebInspector.targetManager.mainTarget();
            if (target)
                target.animationAgent().setPlaybackRate(this._animationsPlaybackRate);
            this._playbackLabel.textContent = this._animationsPlaybackRate + "x";
            WebInspector.userMetrics.AnimationsPlaybackRateChanged.record();
            if (this._scrubberPlayer)
                this._scrubberPlayer.playbackRate = this._animationsPlaybackRate;
        }

        var container = createElementWithClass("div", "animation-timeline-header");
        var controls = container.createChild("div", "animation-controls");
        this._gridMarkers = container.createChild("div", "animation-timeline-markers");

        var replayButton = controls.createSVGChild("svg", "animation-control-replay");
        replayButton.setAttribute("height", 24);
        replayButton.setAttribute("width", 24);
        var g = replayButton.createSVGChild("g")
        var circle = g.createSVGChild("circle");
        circle.setAttribute("cx", 12);
        circle.setAttribute("cy", 12);
        circle.setAttribute("r", 9);
        var triangle = g.createSVGChild("path");
        triangle.setAttribute("d", "M 10 8 L 10 16 L 16 12 z");
        replayButton.addEventListener("click", this._replay.bind(this));

        this._playbackLabel = controls.createChild("div", "source-code animation-playback-label");
        this._playbackLabel.createTextChild("1x");

        this._playbackSlider = controls.createChild("input", "animation-playback-slider");
        this._playbackSlider.type = "range";
        this._playbackSlider.min = 0;
        this._playbackSlider.max = WebInspector.AnimationsSidebarPane.GlobalPlaybackRates.length - 1;
        this._playbackSlider.value = this._playbackSlider.max;
        this._playbackSlider.addEventListener("input", playbackSliderInputHandler.bind(this));
        this._updateAnimationsPlaybackRate();

        return container;
    },

    _updateAnimationsPlaybackRate: function()
    {
        /**
         * @param {?Protocol.Error} error
         * @param {number} playbackRate
         * @this {WebInspector.AnimationTimeline}
         */
        function setPlaybackRate(error, playbackRate)
        {
            this._animationsPlaybackRate = playbackRate;
            this._playbackSlider.value = WebInspector.AnimationsSidebarPane.GlobalPlaybackRates.indexOf(playbackRate);
            this._playbackLabel.textContent = playbackRate + "x";
        }

        var target = WebInspector.targetManager.mainTarget();
        if (target)
            target.animationAgent().getPlaybackRate(setPlaybackRate.bind(this));
    },

    _replay: function()
    {
        if (this.startTime() === undefined)
            return;
        var targets = WebInspector.targetManager.targets();
        for (var target of targets)
            target.animationAgent().setCurrentTime(/** @type {number} */(this.startTime()));
        this._animateTime(0);
    },

    /**
     * @return {number}
     */
    _defaultDuration: function ()
    {
        return 300;
    },

    /**
     * @return {number}
     */
    duration: function()
    {
        return this._duration;
    },

    /**
     * @param {number} duration
     */
    setDuration: function(duration)
    {
        this._duration = duration;
        this.redraw();
    },

    /**
     * @return {number|undefined}
     */
    startTime: function()
    {
        return this._startTime;
    },

    _reset: function()
    {
        if (!this._animations.length)
            return;

        this._animations = [];
        this._uiAnimations = [];
        this._animationsContainer.removeChildren();
        this._duration = this._defaultDuration();
        delete this._startTime;
    },

    /**
     * @param {!WebInspector.Event} event
     */
    _mainFrameNavigated: function(event)
    {
        this._reset();
        this._updateAnimationsPlaybackRate();
        if (this._scrubberPlayer)
            this._scrubberPlayer.cancel();
        delete this._scrubberPlayer;
        this._timelineScrubberHead.textContent = WebInspector.UIString(Number.millisToString(0));
    },

    /**
     * @param {!WebInspector.AnimationModel.AnimationPlayer} animation
     * @param {boolean} resetTimeline
     */
    addAnimation: function(animation, resetTimeline)
    {
        /**
         * @param {!Element} description
         * @param {?WebInspector.DOMNode} node
         */
        function nodeResolved(description, node)
        {
            description.appendChild(WebInspector.DOMPresentationUtils.linkifyNodeReference(node));
            uiAnimation.setNode(node);
        }

        if (resetTimeline)
            this._reset();

        // Ignore Web Animations custom effects & groups
        if (animation.type() === "WebAnimation" && animation.source().keyframesRule().keyframes().length === 0)
            return;

        var row = this._animationsContainer.createChild("div", "animation-row");
        var description = row.createChild("div", "animation-node-description");
        animation.source().getNode(nodeResolved.bind(null, description));
        var container = row.createChild("div", "animation-timeline-row");

        this._resizeWindow(animation);
        this._animations.push(animation);

        var uiAnimation = new WebInspector.AnimationUI(this._stylesPane, animation, this, container);
        this._uiAnimations.push(uiAnimation);
        this.redraw();
    },

    _renderGrid: function()
    {
        this._grid.setAttribute("width", Math.max(0, parseInt(window.getComputedStyle(this._grid.parentElement).width, 10) - 200));
        this._grid.setAttribute("height", "100%");
        this._grid.setAttribute("shape-rendering", "crispEdges");
        this._grid.removeChildren();
        for (var time = 250; time < this.duration(); time += 250) {
            var line = this._grid.createSVGChild("rect", "animation-timeline-grid-line");
            line.setAttribute("x", time * this.pixelMsRatio());
            line.setAttribute("y", 0);
            line.setAttribute("height", "100%");
            line.setAttribute("width", 1);
        }
    },

    redraw: function()
    {
        for (var i = 0; i < this._uiAnimations.length; i++)
            this._uiAnimations[i].redraw();
        this._renderGrid();
    },

    onResize: function()
    {
        this.redraw();
        if (this._scrubberPlayer)
            this._animateTime();
    },

    /**
     * @param {!WebInspector.AnimationModel.AnimationPlayer} animation
     */
    _resizeWindow: function(animation)
    {
        if (!this._startTime)
            this._startTime = animation.startTime();

        // This shows at most 2 iterations
        var iterations = animation.source().iterations() || 1;
        var duration = animation.source().duration() * Math.min(2, iterations);
        var requiredDuration = animation.startTime() + duration + animation.source().delay() - this.startTime();
        if (requiredDuration > this._duration * 0.8)
            this._duration = requiredDuration * 1.5;
        this._animateTime(animation.startTime() - this.startTime());
    },

    /**
      * @param {number=} time
      */
    _animateTime: function(time)
    {
        var oldPlayer = this._scrubberPlayer;

        var width = this._animationsContainer.offsetWidth - 200 || 0;
        this._scrubberPlayer = this._timelineScrubber.animate([
            { transform: "translateX(0px)" },
            { transform: "translateX(" +  (width - this._scrubberRadius) + "px)" }
        ], { duration: this.duration() - this._scrubberRadius / this.pixelMsRatio(), fill: "forwards" });
        this._scrubberPlayer.playbackRate = this._animationsPlaybackRate;

        if (time !== undefined)
            this._scrubberPlayer.currentTime = time;
        else if (oldPlayer.playState === "finished")
            this._scrubberPlayer.finish();
        else
            this._scrubberPlayer.startTime = oldPlayer.startTime;

        if (oldPlayer)
            oldPlayer.cancel();
        this._timelineScrubber.classList.remove("animation-timeline-end");
        this._timelineScrubberHead.window().requestAnimationFrame(this._updateScrubber.bind(this));
    },

    /**
     * @return {number}
     */
    pixelMsRatio: function()
    {
        return (this._animationsContainer.offsetWidth - 200) / this.duration() || 0;
    },

    /**
     * @param {number} timestamp
     */
    _updateScrubber: function(timestamp)
    {
        this._timelineScrubberHead.textContent = WebInspector.UIString(Number.millisToString(this._scrubberPlayer.currentTime));
        if (this._scrubberPlayer.playState === "pending" || this._scrubberPlayer.playState === "running") {
            this._timelineScrubberHead.window().requestAnimationFrame(this._updateScrubber.bind(this));
        } else if (this._scrubberPlayer.playState === "finished") {
            this._timelineScrubberHead.textContent = WebInspector.UIString(". . .");
            this._timelineScrubber.classList.add("animation-timeline-end");
        }
    },

    /**
     * @param {!Event} event
     * @return {boolean}
     */
    _scrubberDragStart: function(event)
    {
        if (!this._scrubberPlayer)
            return false;

        this._originalScrubberTime = this._scrubberPlayer.currentTime;
        this._timelineScrubber.classList.remove("animation-timeline-end");
        this._scrubberPlayer.pause();
        this._originalMousePosition = new WebInspector.Geometry.Point(event.x, event.y);

        var target = WebInspector.targetManager.mainTarget();
        if (target)
            target.animationAgent().setPlaybackRate(0);
        return true;
    },

    /**
     * @param {!Event} event
     */
    _scrubberDragMove: function(event)
    {
        var delta = event.x - this._originalMousePosition.x;
        this._scrubberPlayer.currentTime = Math.min(this._originalScrubberTime + delta / this.pixelMsRatio(), this.duration() - this._scrubberRadius / this.pixelMsRatio());
        var currentTime = Math.max(0, Math.round(this._scrubberPlayer.currentTime));
        this._timelineScrubberHead.textContent = WebInspector.UIString(Number.millisToString(currentTime));
        var targets = WebInspector.targetManager.targets();
        for (var target of targets)
            target.animationAgent().setCurrentTime(/** @type {number} */(this.startTime() + currentTime));
    },

    /**
     * @param {!Event} event
     */
    _scrubberDragEnd: function(event)
    {
        if (this._scrubberPlayer.currentTime < this.duration() - this._scrubberRadius / this.pixelMsRatio())
            this._scrubberPlayer.play();
        this._timelineScrubberHead.window().requestAnimationFrame(this._updateScrubber.bind(this));
        var target = WebInspector.targetManager.mainTarget();
        if (target)
            target.animationAgent().setPlaybackRate(this._animationsPlaybackRate);
    },

    __proto__: WebInspector.VBox.prototype
}

/**
 * @constructor
 * @param {!WebInspector.StylesSidebarPane} stylesPane
 * @param {!WebInspector.AnimationModel.AnimationPlayer} animation
 * @param {!WebInspector.AnimationTimeline} timeline
 * @param {!Element} parentElement
 */
WebInspector.AnimationUI = function(stylesPane, animation, timeline, parentElement) {
    this._stylesPane = stylesPane;
    this._animation = animation;
    this._timeline = timeline;
    this._parentElement = parentElement;

    if (this._animation.source().keyframesRule())
        this._keyframes =  this._animation.source().keyframesRule().keyframes();

    this._nameElement = parentElement.createChild("div", "animation-name");
    this._nameElement.textContent = this._animation.name();

    this._svg = parentElement.createSVGChild("svg");
    this._svg.setAttribute("height", WebInspector.AnimationUI.Options.AnimationSVGHeight);
    this._svg.style.marginLeft = "-" + WebInspector.AnimationUI.Options.AnimationMargin + "px";
    this._svg.addEventListener("mousedown", this._mouseDown.bind(this, WebInspector.AnimationUI.MouseEvents.AnimationDrag, null));
    this._svgGroup = this._svg.createSVGChild("g");

    this._movementInMs = 0;
    this.redraw();
}

/**
 * @enum {string}
 */
WebInspector.AnimationUI.MouseEvents = {
    AnimationDrag: "AnimationDrag",
    KeyframeMove: "KeyframeMove",
    StartEndpointMove: "StartEndpointMove",
    FinishEndpointMove: "FinishEndpointMove"
}

WebInspector.AnimationUI.prototype = {
    /**
     * @param {?WebInspector.DOMNode} node
     */
    setNode: function(node)
    {
        this._node = node;
    },

    _drawAnimationLine: function()
    {
        var line = this._svgGroup.createSVGChild("line", "animation-line");
        line.setAttribute("x1", WebInspector.AnimationUI.Options.AnimationMargin);
        line.setAttribute("y1", WebInspector.AnimationUI.Options.AnimationHeight);
        line.setAttribute("x2", this._duration() * this._timeline.pixelMsRatio() +  WebInspector.AnimationUI.Options.AnimationMargin);
        line.setAttribute("y2", WebInspector.AnimationUI.Options.AnimationHeight);
        line.style.stroke = this._color().asString(WebInspector.Color.Format.RGB);
    },

    /**
     * @param {number} x
     * @param {number} keyframeIndex
     */
    _drawPoint: function(x, keyframeIndex)
    {
        var circle = this._svgGroup.createSVGChild("circle", keyframeIndex <= 0 ? "animation-endpoint" : "animation-keyframe-point");
        circle.setAttribute("cx", x);
        circle.setAttribute("cy", WebInspector.AnimationUI.Options.AnimationHeight);
        circle.style.stroke = this._color().asString(WebInspector.Color.Format.RGB);
        circle.setAttribute("r", WebInspector.AnimationUI.Options.AnimationMargin / 2);

        if (keyframeIndex <= 0)
            circle.style.fill = this._color().asString(WebInspector.Color.Format.RGB);

        if (keyframeIndex == 0) {
            circle.addEventListener("mousedown", this._mouseDown.bind(this, WebInspector.AnimationUI.MouseEvents.StartEndpointMove, keyframeIndex));
        } else if (keyframeIndex == -1) {
            circle.addEventListener("mousedown", this._mouseDown.bind(this, WebInspector.AnimationUI.MouseEvents.FinishEndpointMove, keyframeIndex));
        } else {
            circle.addEventListener("mousedown", this._mouseDown.bind(this, WebInspector.AnimationUI.MouseEvents.KeyframeMove, keyframeIndex));
        }
    },

    /**
     * @param {number} leftDistance
     * @param {number} width
     * @param {!WebInspector.Geometry.CubicBezier} bezier
     */
    _renderBezierKeyframe: function(leftDistance, width, bezier)
    {
        var path = this._svgGroup.createSVGChild("path", "animation-keyframe");
        path.style.transform = "translateX(" + leftDistance + "px)";
        path.style.fill = this._color().asString(WebInspector.Color.Format.RGB);
        WebInspector.BezierUI.drawVelocityChart(bezier, path, width);
    },

    redraw: function()
    {
        var animationWidth = this._duration() * this._timeline.pixelMsRatio() + 2 * WebInspector.AnimationUI.Options.AnimationMargin;
        var leftMargin = (this._animation.startTime() - this._timeline.startTime() + this._delay()) * this._timeline.pixelMsRatio();
        this._svg.setAttribute("width", animationWidth);
        this._svg.style.transform = "translateX(" + leftMargin  + "px)";
        this._nameElement.style.transform = "translateX(" + leftMargin + "px)";
        this._nameElement.style.width = animationWidth + "px";
        this._svgGroup.removeChildren();
        this._drawAnimationLine();
        if (this._animation.type() == "CSSTransition") {
            var bezier = WebInspector.Geometry.CubicBezier.parse(this._animation.source().easing());
            // FIXME: add support for step functions
            if (bezier)
                this._renderBezierKeyframe(WebInspector.AnimationUI.Options.AnimationMargin, this._duration() * this._timeline.pixelMsRatio(), bezier);
            this._drawPoint(WebInspector.AnimationUI.Options.AnimationMargin, 0);
        } else {
            console.assert(this._keyframes.length > 1);
            for (var i = 0; i < this._keyframes.length - 1; i++) {
                var leftDistance = this._offset(i) * this._duration() * this._timeline.pixelMsRatio() + WebInspector.AnimationUI.Options.AnimationMargin;
                var width = this._duration() * (this._offset(i + 1) - this._offset(i)) * this._timeline.pixelMsRatio();
                var bezier = WebInspector.Geometry.CubicBezier.parse(this._keyframes[i].easing());
                // FIXME: add support for step functions
                if (bezier)
                    this._renderBezierKeyframe(leftDistance, width, bezier);
                this._drawPoint(leftDistance, i);
            }
        }
        this._drawPoint(this._duration() * this._timeline.pixelMsRatio() +  WebInspector.AnimationUI.Options.AnimationMargin, -1);
    },

    /**
     * @return {number}
     */
    _delay: function()
    {
        var delay = this._animation.source().delay();
        if (this._mouseEventType === WebInspector.AnimationUI.MouseEvents.AnimationDrag || this._mouseEventType    === WebInspector.AnimationUI.MouseEvents.StartEndpointMove)
            delay += this._movementInMs;
        // FIXME: add support for negative start delay
        return Math.max(0, delay);
    },

    /**
     * @return {number}
     */
    _duration: function()
    {
        var duration = this._animation.source().duration();
        if (this._mouseEventType === WebInspector.AnimationUI.MouseEvents.FinishEndpointMove)
            duration += this._movementInMs;
        else if (this._mouseEventType === WebInspector.AnimationUI.MouseEvents.StartEndpointMove)
            duration -= this._movementInMs;
        return Math.max(0, duration);
    },

    /**
     * @param {number} i
     * @return {number} offset
     */
    _offset: function(i)
    {
        var offset = this._keyframes[i].offsetAsNumber();
        if (this._mouseEventType === WebInspector.AnimationUI.MouseEvents.KeyframeMove && i === this._keyframeMoved) {
            console.assert(i > 0 && i < this._keyframes.length - 1, "First and last keyframe cannot be moved");
            offset += this._movementInMs / this._animation.source().duration();
            offset = Math.max(offset, this._keyframes[i - 1].offsetAsNumber());
            offset = Math.min(offset, this._keyframes[i + 1].offsetAsNumber());
        }
        return offset;
    },

    /**
     * @param {!WebInspector.AnimationUI.MouseEvents} mouseEventType
     * @param {?number} keyframeIndex
     * @param {!Event} event
     */
    _mouseDown: function(mouseEventType, keyframeIndex, event)
    {
        this._mouseEventType = mouseEventType;
        this._keyframeMoved = keyframeIndex;
        this._downMouseX = event.clientX;
        this._mouseMoveHandler = this._mouseMove.bind(this);
        this._mouseUpHandler = this._mouseUp.bind(this);
        this._parentElement.ownerDocument.addEventListener("mousemove", this._mouseMoveHandler);
        this._parentElement.ownerDocument.addEventListener("mouseup", this._mouseUpHandler);
        event.preventDefault();
        event.stopPropagation();

        if (this._node)
            WebInspector.Revealer.reveal(this._node);
    },

    /**
     * @param {!Event} event
     */
    _mouseMove: function (event)
    {
        this._movementInMs = (event.clientX - this._downMouseX) / this._timeline.pixelMsRatio();
        if (this._animation.startTime() + this._delay() + this._duration() - this._timeline.startTime() > this._timeline.duration() * 0.8)
            this._timeline.setDuration(this._timeline.duration() * 1.2);
        this.redraw();
    },

    /**
     * @param {!Event} event
     */
    _mouseUp: function(event)
    {
        this._movementInMs = (event.clientX - this._downMouseX) / this._timeline.pixelMsRatio();

        // Commit changes
        if (this._mouseEventType === WebInspector.AnimationUI.MouseEvents.KeyframeMove) {
            this._keyframes[this._keyframeMoved].setOffset(this._offset(this._keyframeMoved));
        } else {
            this._setDelay(this._delay());
            this._setDuration(this._duration());
        }

        this._movementInMs = 0;
        this.redraw();

        this._parentElement.ownerDocument.removeEventListener("mousemove", this._mouseMoveHandler);
        this._parentElement.ownerDocument.removeEventListener("mouseup", this._mouseUpHandler);
        delete this._mouseMoveHandler;
        delete this._mouseUpHandler;
        delete this._mouseEventType;
        delete this._downMouseX;
        delete this._keyframeMoved;
    },

    /**
     * @param {number} value
     */
    _setDelay: function(value)
    {
        if (!this._node || this._animation.source().delay() == this._delay())
            return;

        this._animation.source().setDelay(this._delay());
        var propertyName;
        if (this._animation.type() == "CSSTransition")
            propertyName = "transition-delay";
        else if (this._animation.type() == "CSSAnimation")
            propertyName = "animation-delay";
        else
            return; // FIXME: support web animations
        this._setNodeStyle(propertyName, Math.round(value) + "ms");
    },

    /**
     * @param {number} value
     */
    _setDuration: function(value)
    {
        if (!this._node || this._animation.source().duration() == value)
            return;

        this._animation.source().setDuration(value);
        var propertyName;
        if (this._animation.type() == "CSSTransition")
            propertyName = "transition-duration";
        else if (this._animation.type() == "CSSAnimation")
            propertyName = "animation-duration";
        else
            return; // FIXME: support web animations
        this._setNodeStyle(propertyName, Math.round(value) + "ms");
    },

    /**
     * @param {string} name
     * @param {string} value
     */
    _setNodeStyle: function(name, value)
    {
        var style = this._node.getAttribute("style") || "";
        if (style)
            style = style.replace(new RegExp("\\s*(-webkit-)?" + name + ":[^;]*;?\\s*", "g"), "");
        var valueString = name + ": " + value;
        this._node.setAttributeValue("style", style + " " + valueString + "; -webkit-" + valueString + ";");
    },

    /**
     * @return {!WebInspector.Color}
     */
    _color: function()
    {
        /**
         * @param {string} string
         * @return {number}
         */
        function hash(string)
        {
            var hash = 0;
            for (var i = 0; i < string.length; i++)
                hash = (hash << 5) + hash + string.charCodeAt(i);
            return Math.abs(hash);
        }

        if (!this._selectedColor) {
            var names = Object.keys(WebInspector.AnimationUI.Colors);
            this._selectedColor = WebInspector.AnimationUI.Colors[names[hash(this._animation.name()) % names.length]];
        }
        return this._selectedColor;
    }
}

WebInspector.AnimationUI.Options = {
    AnimationHeight: 32,
    AnimationSVGHeight: 80,
    AnimationMargin: 8,
    EndpointsClickRegionSize: 10,
    GridCanvasHeight: 40
}

WebInspector.AnimationUI.Colors = {
    "Purple": WebInspector.Color.parse("#9C27B0"),
    "Light Blue": WebInspector.Color.parse("#03A9F4"),
    "Deep Orange": WebInspector.Color.parse("#FF5722"),
    "Blue": WebInspector.Color.parse("#5677FC"),
    "Lime": WebInspector.Color.parse("#CDDC39"),
    "Blue Grey": WebInspector.Color.parse("#607D8B"),
    "Pink": WebInspector.Color.parse("#E91E63"),
    "Green": WebInspector.Color.parse("#0F9D58"),
    "Brown": WebInspector.Color.parse("#795548"),
    "Cyan": WebInspector.Color.parse("#00BCD4")
}
