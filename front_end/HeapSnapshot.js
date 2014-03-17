/*
 * Copyright (C) 2011 Google Inc. All rights reserved.
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
 * @param {!Uint32Array} array
 * @param {number} start
 * @param {number} end
 */
WebInspector.HeapSnapshotArraySlice = function(array, start, end)
{
    this._array = array;
    this._start = start;
    this.length = end - start;
}

WebInspector.HeapSnapshotArraySlice.prototype = {
    /**
     * @param {number} index
     * @return {number}
     */
    item: function(index)
    {
        return this._array[this._start + index];
    },

    /**
     * @param {number} start
     * @param {number=} end
     * @return {!Uint32Array}
     */
    slice: function(start, end)
    {
        if (typeof end === "undefined")
            end = this.length;
        return this._array.subarray(this._start + start, this._start + end);
    }
}

/**
 * @constructor
 * @param {number=} edgeIndex
 */
WebInspector.HeapSnapshotEdge = function(snapshot, edges, edgeIndex)
{
    this._snapshot = snapshot;
    this._edges = edges;
    this.edgeIndex = edgeIndex || 0;
}

/**
 * @constructor
 * @param {string} name
 * @param {!WebInspector.HeapSnapshotNode.Serialized} node
 * @param {number} nodeIndex
 * @param {string} type
 * @param {number} distance
 */
WebInspector.HeapSnapshotEdge.Serialized = function(name, node, nodeIndex, type, distance) {
    this.name = name;
    this.node = node;
    this.nodeIndex = nodeIndex;
    this.type = type;
    this.distance = distance;
};

WebInspector.HeapSnapshotEdge.prototype = {
    /**
     * @return {!WebInspector.HeapSnapshotEdge}
     */
    clone: function()
    {
        return new WebInspector.HeapSnapshotEdge(this._snapshot, this._edges, this.edgeIndex);
    },

    /**
     * @return {boolean}
     */
    hasStringName: function()
    {
        throw new Error("Not implemented");
    },

    /**
     * @return {string}
     */
    name: function()
    {
        throw new Error("Not implemented");
    },

    /**
     * @return {!WebInspector.HeapSnapshotNode}
     */
    node: function()
    {
        return this._snapshot.createNode(this.nodeIndex());
    },

    /**
     * @return {number}
     */
    nodeIndex: function()
    {
        return this._edges.item(this.edgeIndex + this._snapshot._edgeToNodeOffset);
    },

    /**
     * @return {!Array.<number>}
     */
    rawEdges: function()
    {
        return this._edges;
    },

    /**
     * @return {string}
     */
    toString: function()
    {
        return "HeapSnapshotEdge: " + this.name();
    },

    /**
     * @return {string}
     */
    type: function()
    {
        return this._snapshot._edgeTypes[this._type()];
    },

    /**
     * @return {!WebInspector.HeapSnapshotEdge.Serialized}
     */
    serialize: function()
    {
        var node = this.node();
        return new WebInspector.HeapSnapshotEdge.Serialized(this.name(), node.serialize(), this.nodeIndex(), this.type(), node.distance());
    },

    _type: function()
    {
        return this._edges.item(this.edgeIndex + this._snapshot._edgeTypeOffset);
    }
};

/**
 * @constructor
 */
WebInspector.HeapSnapshotEdgeIterator = function(edge)
{
    this.edge = edge;
}

WebInspector.HeapSnapshotEdgeIterator.prototype = {
    rewind: function()
    {
        this.edge.edgeIndex = 0;
    },

    /**
     * @return {boolean}
     */
    hasNext: function()
    {
        return this.edge.edgeIndex < this.edge._edges.length;
    },

    /**
     * @return {number}
     */
    index: function()
    {
        return this.edge.edgeIndex;
    },

    /**
     * @param {number} newIndex
     */
    setIndex: function(newIndex)
    {
        this.edge.edgeIndex = newIndex;
    },

    /**
     * @return {!WebInspector.HeapSnapshotEdge}
     */
    item: function()
    {
        return this.edge;
    },

    next: function()
    {
        this.edge.edgeIndex += this.edge._snapshot._edgeFieldsCount;
    }
};

/**
 * @constructor
 */
WebInspector.HeapSnapshotRetainerEdge = function(snapshot, retainedNodeIndex, retainerIndex)
{
    this._snapshot = snapshot;
    this._retainedNodeIndex = retainedNodeIndex;

    var retainedNodeOrdinal = retainedNodeIndex / snapshot._nodeFieldCount;
    this._firstRetainer = snapshot._firstRetainerIndex[retainedNodeOrdinal];
    this._retainersCount = snapshot._firstRetainerIndex[retainedNodeOrdinal + 1] - this._firstRetainer;

    this.setRetainerIndex(retainerIndex);
}

/**
 * @constructor
 * @param {string} name
 * @param {!WebInspector.HeapSnapshotNode.Serialized} node
 * @param {number} nodeIndex
 * @param {string} type
 * @param {number} distance
 */
WebInspector.HeapSnapshotRetainerEdge.Serialized = function(name, node, nodeIndex, type, distance) {
    this.name = name;
    this.node = node;
    this.nodeIndex = nodeIndex;
    this.type = type;
    this.distance = distance;
}

WebInspector.HeapSnapshotRetainerEdge.prototype = {
    /**
     * @return {!WebInspector.HeapSnapshotRetainerEdge}
     */
    clone: function()
    {
        return new WebInspector.HeapSnapshotRetainerEdge(this._snapshot, this._retainedNodeIndex, this.retainerIndex());
    },

    /**
     * @return {boolean}
     */
    hasStringName: function()
    {
        return this._edge().hasStringName();
    },

    /**
     * @return {string}
     */
    name: function()
    {
        return this._edge().name();
    },

    /**
     * @return {!WebInspector.HeapSnapshotNode}
     */
    node: function()
    {
        return this._node();
    },

    /**
     * @return {number}
     */
    nodeIndex: function()
    {
        return this._nodeIndex;
    },

    /**
     * @return {number}
     */
    retainerIndex: function()
    {
        return this._retainerIndex;
    },

    /**
     * @param {number} newIndex
     */
    setRetainerIndex: function(newIndex)
    {
        if (newIndex !== this._retainerIndex) {
            this._retainerIndex = newIndex;
            this.edgeIndex = newIndex;
        }
    },

    /**
     * @param {number} edgeIndex
     */
    set edgeIndex(edgeIndex)
    {
        var retainerIndex = this._firstRetainer + edgeIndex;
        this._globalEdgeIndex = this._snapshot._retainingEdges[retainerIndex];
        this._nodeIndex = this._snapshot._retainingNodes[retainerIndex];
        delete this._edgeInstance;
        delete this._nodeInstance;
    },

    _node: function()
    {
        if (!this._nodeInstance)
            this._nodeInstance = this._snapshot.createNode(this._nodeIndex);
        return this._nodeInstance;
    },

    _edge: function()
    {
        if (!this._edgeInstance) {
            var edgeIndex = this._globalEdgeIndex - this._node()._edgeIndexesStart();
            this._edgeInstance = this._snapshot.createEdge(this._node().rawEdges(), edgeIndex);
        }
        return this._edgeInstance;
    },

    /**
     * @return {string}
     */
    toString: function()
    {
        return this._edge().toString();
    },

    /**
     * @return {!WebInspector.HeapSnapshotRetainerEdge.Serialized}
     */
    serialize: function()
    {
        var node = this.node();
        return new WebInspector.HeapSnapshotRetainerEdge.Serialized(this.name(), node.serialize(), this.nodeIndex(), this.type(), node.distance());
    },

    /**
     * @return {string}
     */
    type: function()
    {
        return this._edge().type();
    }
}

/**
 * @constructor
 */
WebInspector.HeapSnapshotRetainerEdgeIterator = function(retainer)
{
    this.retainer = retainer;
}

WebInspector.HeapSnapshotRetainerEdgeIterator.prototype = {
    rewind: function()
    {
        this.retainer.setRetainerIndex(0);
    },

    /**
     * @return {boolean}
     */
    hasNext: function()
    {
        return this.retainer.retainerIndex() < this.retainer._retainersCount;
    },

    /**
     * @return {number}
     */
    index: function()
    {
        return this.retainer.retainerIndex();
    },

    /**
     * @param {number} newIndex
     */
    setIndex: function(newIndex)
    {
        this.retainer.setRetainerIndex(newIndex);
    },

    /**
     * @return {!WebInspector.HeapSnapshotRetainerEdge}
     */
    item: function()
    {
        return this.retainer;
    },

    next: function()
    {
        this.retainer.setRetainerIndex(this.retainer.retainerIndex() + 1);
    }
};

/**
 * @constructor
 * @param {number=} nodeIndex
 */
WebInspector.HeapSnapshotNode = function(snapshot, nodeIndex)
{
    this._snapshot = snapshot;
    this._firstNodeIndex = nodeIndex;
    this.nodeIndex = nodeIndex;
}

/**
 * @constructor
 * @param {string} id
 * @param {string} name
 * @param {number} distance
 * @param {number|undefined} nodeIndex
 * @param {number} retainedSize
 * @param {number} selfSize
 * @param {string} type
 */
WebInspector.HeapSnapshotNode.Serialized = function(id, name, distance, nodeIndex, retainedSize, selfSize, type) {
    this.id = id;
    this.name = name;
    this.distance = distance;
    this.nodeIndex = nodeIndex;
    this.retainedSize = retainedSize;
    this.selfSize = selfSize;
    this.type = type;
}

WebInspector.HeapSnapshotNode.prototype = {
    /**
     * @return {number}
     */
    distance: function()
    {
        return this._snapshot._nodeDistances[this.nodeIndex / this._snapshot._nodeFieldCount];
    },

    /**
     * @return {string}
     */
    className: function()
    {
        throw new Error("Not implemented");
    },

    /**
     * @return {number}
     */
    classIndex: function()
    {
        throw new Error("Not implemented");
    },

    /**
     * @return {number}
     */
    dominatorIndex: function()
    {
        var nodeFieldCount = this._snapshot._nodeFieldCount;
        return this._snapshot._dominatorsTree[this.nodeIndex / this._snapshot._nodeFieldCount] * nodeFieldCount;
    },

    /**
     * @return {!WebInspector.HeapSnapshotEdgeIterator}
     */
    edges: function()
    {
        return new WebInspector.HeapSnapshotEdgeIterator(this._snapshot.createEdge(this.rawEdges(), 0));
    },

    /**
     * @return {number}
     */
    edgesCount: function()
    {
        return (this._edgeIndexesEnd() - this._edgeIndexesStart()) / this._snapshot._edgeFieldsCount;
    },

    id: function()
    {
        throw new Error("Not implemented");
    },

    /**
     * @return {boolean}
     */
    isRoot: function()
    {
        return this.nodeIndex === this._snapshot._rootNodeIndex;
    },

    /**
     * @return {string}
     */
    name: function()
    {
        return this._snapshot._strings[this._name()];
    },

    /**
     * @return {!WebInspector.HeapSnapshotArraySlice}
     */
    rawEdges: function()
    {
        return new WebInspector.HeapSnapshotArraySlice(this._snapshot._containmentEdges, this._edgeIndexesStart(), this._edgeIndexesEnd());
    },

    /**
     * @return {number}
     */
    retainedSize: function()
    {
        return this._snapshot._retainedSizes[this._ordinal()];
    },

    /**
     * @return {!WebInspector.HeapSnapshotRetainerEdgeIterator}
     */
    retainers: function()
    {
        return new WebInspector.HeapSnapshotRetainerEdgeIterator(this._snapshot.createRetainingEdge(this.nodeIndex, 0));
    },

    /**
     * @return {number}
     */
    retainersCount: function()
    {
        var snapshot = this._snapshot;
        var ordinal = this._ordinal();
        return snapshot._firstRetainerIndex[ordinal + 1] - snapshot._firstRetainerIndex[ordinal];
    },

    /**
     * @return {number}
     */
    selfSize: function()
    {
        var snapshot = this._snapshot;
        return snapshot._nodes[this.nodeIndex + snapshot._nodeSelfSizeOffset];
    },

    /**
     * @return {string}
     */
    type: function()
    {
        return this._snapshot._nodeTypes[this._type()];
    },

    /**
     * @return {number}
     */
    traceNodeId: function()
    {
        var snapshot = this._snapshot;
        return snapshot._nodes[this.nodeIndex + snapshot._nodeTraceNodeIdOffset];
    },

    /**
     * @return {!WebInspector.HeapSnapshotNode.Serialized}
     */
    serialize: function()
    {
        return new WebInspector.HeapSnapshotNode.Serialized(this.id(), this.name(), this.distance(), this.nodeIndex, this.retainedSize(), this.selfSize(), this.type());
    },

    /**
     * @return {number}
     */
    _name: function()
    {
        var snapshot = this._snapshot;
        return snapshot._nodes[this.nodeIndex + snapshot._nodeNameOffset];
    },

    /**
     * @return {number}
     */
    _edgeIndexesStart: function()
    {
        return this._snapshot._firstEdgeIndexes[this._ordinal()];
    },

    /**
     * @return {number}
     */
    _edgeIndexesEnd: function()
    {
        return this._snapshot._firstEdgeIndexes[this._ordinal() + 1];
    },

    /**
     * @return {number}
     */
    _ordinal: function()
    {
        return this.nodeIndex / this._snapshot._nodeFieldCount;
    },

    /**
     * @return {number}
     */
    _nextNodeIndex: function()
    {
        return this.nodeIndex + this._snapshot._nodeFieldCount;
    },

    /**
     * @return {number}
     */
    _type: function()
    {
        var snapshot = this._snapshot;
        return snapshot._nodes[this.nodeIndex + snapshot._nodeTypeOffset];
    }
};

/**
 * @constructor
 */
WebInspector.HeapSnapshotNodeIterator = function(node)
{
    this.node = node;
    this._nodesLength = node._snapshot._nodes.length;
}

WebInspector.HeapSnapshotNodeIterator.prototype = {
    rewind: function()
    {
        this.node.nodeIndex = this.node._firstNodeIndex;
    },

    /**
     * @return {boolean}
     */
    hasNext: function()
    {
        return this.node.nodeIndex < this._nodesLength;
    },

    /**
     * @return {number}
     */
    index: function()
    {
        return this.node.nodeIndex;
    },

    /**
     * @param {number} newIndex
     */
    setIndex: function(newIndex)
    {
        this.node.nodeIndex = newIndex;
    },

    /**
     * @return {!WebInspector.HeapSnapshotNode}
     */
    item: function()
    {
        return this.node;
    },

    next: function()
    {
        this.node.nodeIndex = this.node._nextNodeIndex();
    }
}


/**
 * @param {!WebInspector.HeapSnapshotWorkerDispatcher=} dispatcher
 * @constructor
 */
WebInspector.HeapSnapshotProgress = function(dispatcher)
{
    this._dispatcher = dispatcher;
}

WebInspector.HeapSnapshotProgress.prototype = {
    /**
     * @param {string} status
     */
    updateStatus: function(status)
    {
        this._sendUpdateEvent(WebInspector.UIString(status));
    },

    /**
     * @param {string} title
     * @param {number} value
     * @param {number} total
     */
    updateProgress: function(title, value, total)
    {
        var percentValue = ((total ? (value / total) : 0) * 100).toFixed(0);
        this._sendUpdateEvent(WebInspector.UIString(title, percentValue));
    },

    /**
     * @param {string} text
     */
    _sendUpdateEvent: function(text)
    {
        // May be undefined in tests.
        if (this._dispatcher)
            this._dispatcher.sendEvent(WebInspector.HeapSnapshotProgressEvent.Update, text);
    }
}


/**
 * @param {!WebInspector.HeapSnapshotProgress} progress
 * @constructor
 */
WebInspector.HeapSnapshot = function(profile, progress)
{
    this._nodes = profile.nodes;
    this._containmentEdges = profile.edges;
    /** @type {!HeapSnapshotMetainfo} */
    this._metaNode = profile.snapshot.meta;
    this._strings = profile.strings;
    this._progress = progress;

    this._noDistance = -5;
    this._rootNodeIndex = 0;
    if (profile.snapshot.root_index)
        this._rootNodeIndex = profile.snapshot.root_index;

    this._snapshotDiffs = {};
    this._aggregatesForDiff = null;

    this._init();

    if (profile.snapshot.trace_function_count) {
        this._progress.updateStatus("Buiding allocation statistics\u2026");
        var nodes = this._nodes;
        var nodesLength = nodes.length;
        var nodeFieldCount = this._nodeFieldCount;
        var node = this.rootNode();
        var liveObjects = {};
        for (var nodeIndex = 0; nodeIndex < nodesLength; nodeIndex += nodeFieldCount) {
            node.nodeIndex = nodeIndex;
            var traceNodeId = node.traceNodeId();
            var stats = liveObjects[traceNodeId];
            if (!stats) {
                liveObjects[traceNodeId] = stats = { count: 0, size: 0};
            }
            stats.count++;
            stats.size += node.selfSize();
        }
        this._allocationProfile = new WebInspector.AllocationProfile(profile, liveObjects);
        this._progress.updateStatus("Done");
    }
}

/**
 * @constructor
 */
function HeapSnapshotMetainfo()
{
    // New format.
    this.node_fields = [];
    this.node_types = [];
    this.edge_fields = [];
    this.edge_types = [];
    this.trace_function_info_fields = [];
    this.trace_node_fields = [];
    this.type_strings = {};
}

/**
 * @constructor
 */
function HeapSnapshotHeader()
{
    // New format.
    this.title = "";
    this.meta = new HeapSnapshotMetainfo();
    this.node_count = 0;
    this.edge_count = 0;
}

WebInspector.HeapSnapshot.prototype = {
    _init: function()
    {
        var meta = this._metaNode;

        this._nodeTypeOffset = meta.node_fields.indexOf("type");
        this._nodeNameOffset = meta.node_fields.indexOf("name");
        this._nodeIdOffset = meta.node_fields.indexOf("id");
        this._nodeSelfSizeOffset = meta.node_fields.indexOf("self_size");
        this._nodeEdgeCountOffset = meta.node_fields.indexOf("edge_count");
        this._nodeTraceNodeIdOffset = meta.node_fields.indexOf("trace_node_id");
        this._nodeFieldCount = meta.node_fields.length;

        this._nodeTypes = meta.node_types[this._nodeTypeOffset];
        this._nodeHiddenType = this._nodeTypes.indexOf("hidden");
        this._nodeObjectType = this._nodeTypes.indexOf("object");
        this._nodeNativeType = this._nodeTypes.indexOf("native");
        this._nodeConsStringType = this._nodeTypes.indexOf("concatenated string");
        this._nodeSlicedStringType = this._nodeTypes.indexOf("sliced string");
        this._nodeCodeType = this._nodeTypes.indexOf("code");
        this._nodeSyntheticType = this._nodeTypes.indexOf("synthetic");

        this._edgeFieldsCount = meta.edge_fields.length;
        this._edgeTypeOffset = meta.edge_fields.indexOf("type");
        this._edgeNameOffset = meta.edge_fields.indexOf("name_or_index");
        this._edgeToNodeOffset = meta.edge_fields.indexOf("to_node");

        this._edgeTypes = meta.edge_types[this._edgeTypeOffset];
        this._edgeTypes.push("invisible");
        this._edgeElementType = this._edgeTypes.indexOf("element");
        this._edgeHiddenType = this._edgeTypes.indexOf("hidden");
        this._edgeInternalType = this._edgeTypes.indexOf("internal");
        this._edgeShortcutType = this._edgeTypes.indexOf("shortcut");
        this._edgeWeakType = this._edgeTypes.indexOf("weak");
        this._edgeInvisibleType = this._edgeTypes.indexOf("invisible");

        this.nodeCount = this._nodes.length / this._nodeFieldCount;
        this._edgeCount = this._containmentEdges.length / this._edgeFieldsCount;

        this._progress.updateStatus("Building edge indexes\u2026");
        this._buildEdgeIndexes();
        this._progress.updateStatus("Marking invisible edges\u2026");
        this._markInvisibleEdges();
        this._progress.updateStatus("Building retainers\u2026");
        this._buildRetainers();
        this._progress.updateStatus("Calculating node flags\u2026");
        this._calculateFlags();
        this._progress.updateStatus("Calculating distances\u2026");
        this._calculateDistances();
        this._progress.updateStatus("Building postorder index\u2026");
        var result = this._buildPostOrderIndex();
        // Actually it is array that maps node ordinal number to dominator node ordinal number.
        this._progress.updateStatus("Building dominator tree\u2026");
        this._dominatorsTree = this._buildDominatorTree(result.postOrderIndex2NodeOrdinal, result.nodeOrdinal2PostOrderIndex);
        this._progress.updateStatus("Calculating retained sizes\u2026");
        this._calculateRetainedSizes(result.postOrderIndex2NodeOrdinal);
        this._progress.updateStatus("Buiding dominated nodes\u2026");
        this._buildDominatedNodes();
        this._progress.updateStatus("Calculating statistics\u2026");
        this._calculateStatistics();
        this._progress.updateStatus("Finished processing.");
    },

    _buildEdgeIndexes: function()
    {
        var nodes = this._nodes;
        var nodeCount = this.nodeCount;
        var firstEdgeIndexes = this._firstEdgeIndexes = new Uint32Array(nodeCount + 1);
        var nodeFieldCount = this._nodeFieldCount;
        var edgeFieldsCount = this._edgeFieldsCount;
        var nodeEdgeCountOffset = this._nodeEdgeCountOffset;
        firstEdgeIndexes[nodeCount] = this._containmentEdges.length;
        for (var nodeOrdinal = 0, edgeIndex = 0; nodeOrdinal < nodeCount; ++nodeOrdinal) {
            firstEdgeIndexes[nodeOrdinal] = edgeIndex;
            edgeIndex += nodes[nodeOrdinal * nodeFieldCount + nodeEdgeCountOffset] * edgeFieldsCount;
        }
    },

    _buildRetainers: function()
    {
        var retainingNodes = this._retainingNodes = new Uint32Array(this._edgeCount);
        var retainingEdges = this._retainingEdges = new Uint32Array(this._edgeCount);
        // Index of the first retainer in the _retainingNodes and _retainingEdges
        // arrays. Addressed by retained node index.
        var firstRetainerIndex = this._firstRetainerIndex = new Uint32Array(this.nodeCount + 1);

        var containmentEdges = this._containmentEdges;
        var edgeFieldsCount = this._edgeFieldsCount;
        var nodeFieldCount = this._nodeFieldCount;
        var edgeToNodeOffset = this._edgeToNodeOffset;
        var firstEdgeIndexes = this._firstEdgeIndexes;
        var nodeCount = this.nodeCount;

        for (var toNodeFieldIndex = edgeToNodeOffset, l = containmentEdges.length; toNodeFieldIndex < l; toNodeFieldIndex += edgeFieldsCount) {
            var toNodeIndex = containmentEdges[toNodeFieldIndex];
            if (toNodeIndex % nodeFieldCount)
                throw new Error("Invalid toNodeIndex " + toNodeIndex);
            ++firstRetainerIndex[toNodeIndex / nodeFieldCount];
        }
        for (var i = 0, firstUnusedRetainerSlot = 0; i < nodeCount; i++) {
            var retainersCount = firstRetainerIndex[i];
            firstRetainerIndex[i] = firstUnusedRetainerSlot;
            retainingNodes[firstUnusedRetainerSlot] = retainersCount;
            firstUnusedRetainerSlot += retainersCount;
        }
        firstRetainerIndex[nodeCount] = retainingNodes.length;

        var nextNodeFirstEdgeIndex = firstEdgeIndexes[0];
        for (var srcNodeOrdinal = 0; srcNodeOrdinal < nodeCount; ++srcNodeOrdinal) {
            var firstEdgeIndex = nextNodeFirstEdgeIndex;
            nextNodeFirstEdgeIndex = firstEdgeIndexes[srcNodeOrdinal + 1];
            var srcNodeIndex = srcNodeOrdinal * nodeFieldCount;
            for (var edgeIndex = firstEdgeIndex; edgeIndex < nextNodeFirstEdgeIndex; edgeIndex += edgeFieldsCount) {
                var toNodeIndex = containmentEdges[edgeIndex + edgeToNodeOffset];
                if (toNodeIndex % nodeFieldCount)
                    throw new Error("Invalid toNodeIndex " + toNodeIndex);
                var firstRetainerSlotIndex = firstRetainerIndex[toNodeIndex / nodeFieldCount];
                var nextUnusedRetainerSlotIndex = firstRetainerSlotIndex + (--retainingNodes[firstRetainerSlotIndex]);
                retainingNodes[nextUnusedRetainerSlotIndex] = srcNodeIndex;
                retainingEdges[nextUnusedRetainerSlotIndex] = edgeIndex;
            }
        }
    },

    /**
     * @param {number=} nodeIndex
     */
    createNode: function(nodeIndex)
    {
        throw new Error("Not implemented");
    },

    createEdge: function(edges, edgeIndex)
    {
        throw new Error("Not implemented");
    },

    createRetainingEdge: function(retainedNodeIndex, retainerIndex)
    {
        throw new Error("Not implemented");
    },

    dispose: function()
    {
        delete this._nodes;
        delete this._strings;
        delete this._retainingEdges;
        delete this._retainingNodes;
        delete this._firstRetainerIndex;
        if (this._aggregates) {
            delete this._aggregates;
            delete this._aggregatesSortedFlags;
        }
        delete this._dominatedNodes;
        delete this._firstDominatedNodeIndex;
        delete this._nodeDistances;
        delete this._dominatorsTree;
    },

    _allNodes: function()
    {
        return new WebInspector.HeapSnapshotNodeIterator(this.rootNode());
    },

    /**
     * @return {!WebInspector.HeapSnapshotNode}
     */
    rootNode: function()
    {
        return this.createNode(this._rootNodeIndex);
    },

    get rootNodeIndex()
    {
        return this._rootNodeIndex;
    },

    get totalSize()
    {
        return this.rootNode().retainedSize();
    },

    _getDominatedIndex: function(nodeIndex)
    {
        if (nodeIndex % this._nodeFieldCount)
            throw new Error("Invalid nodeIndex: " + nodeIndex);
        return this._firstDominatedNodeIndex[nodeIndex / this._nodeFieldCount];
    },

    _dominatedNodesOfNode: function(node)
    {
        var dominatedIndexFrom = this._getDominatedIndex(node.nodeIndex);
        var dominatedIndexTo = this._getDominatedIndex(node._nextNodeIndex());
        return new WebInspector.HeapSnapshotArraySlice(this._dominatedNodes, dominatedIndexFrom, dominatedIndexTo);
    },

    /**
     * @param {!WebInspector.HeapSnapshotCommon.NodeFilter} nodeFilter
     * @return {!Object.<string, !WebInspector.HeapSnapshotCommon.Aggregate>}
     */
    aggregatesWithFilter: function(nodeFilter)
    {
        var minNodeId = nodeFilter.minNodeId;
        var maxNodeId = nodeFilter.maxNodeId;
        var key;
        var filter;
        /**
         * @param {!WebInspector.HeapSnapshotNode} node
         * @return boolean
         */
        function filterById(node)
        {
            var id = node.id();
            return id > minNodeId && id <= maxNodeId;
        }
        if (typeof minNodeId === "number") {
            key = minNodeId + ".." + maxNodeId;
            filter = filterById;
        } else {
            key = "allObjects";
        }
        return this.aggregates(false, key, filter);
    },

    /**
     * @param {boolean} sortedIndexes
     * @param {string} key
     * @param {function(!WebInspector.HeapSnapshotNode):boolean=} filter
     * @return {!Object.<string, !WebInspector.HeapSnapshotCommon.Aggregate>}
     */
    aggregates: function(sortedIndexes, key, filter)
    {
        if (!this._aggregates) {
            this._aggregates = {};
            this._aggregatesSortedFlags = {};
        }

        var aggregatesByClassName = this._aggregates[key];
        if (aggregatesByClassName) {
            if (sortedIndexes && !this._aggregatesSortedFlags[key]) {
                this._sortAggregateIndexes(aggregatesByClassName);
                this._aggregatesSortedFlags[key] = sortedIndexes;
            }
            return aggregatesByClassName;
        }

        var aggregates = this._buildAggregates(filter);
        this._calculateClassesRetainedSize(aggregates.aggregatesByClassIndex, filter);
        aggregatesByClassName = aggregates.aggregatesByClassName;

        if (sortedIndexes)
            this._sortAggregateIndexes(aggregatesByClassName);

        this._aggregatesSortedFlags[key] = sortedIndexes;
        this._aggregates[key] = aggregatesByClassName;

        return aggregatesByClassName;
    },

    /**
     * @return {!Array.<!WebInspector.HeapSnapshotCommon.SerializedAllocationNode>}
     */
    allocationTracesTops: function()
    {
        return this._allocationProfile.serializeTraceTops();
    },

    /**
     * @param {string} nodeId
     * @return {!WebInspector.HeapSnapshotCommon.AllocationNodeCallers}
     */
    allocationNodeCallers: function(nodeId)
    {
        return this._allocationProfile.serializeCallers(nodeId);
    },

    /**
     * @return {!Object.<string, !WebInspector.HeapSnapshotCommon.AggregateForDiff>}
     */
    aggregatesForDiff: function()
    {
        if (this._aggregatesForDiff)
            return this._aggregatesForDiff;

        var aggregatesByClassName = this.aggregates(true, "allObjects");
        this._aggregatesForDiff  = {};

        var node = this.createNode();
        for (var className in aggregatesByClassName) {
            var aggregate = aggregatesByClassName[className];
            var indexes = aggregate.idxs;
            var ids = new Array(indexes.length);
            var selfSizes = new Array(indexes.length);
            for (var i = 0; i < indexes.length; i++) {
                node.nodeIndex = indexes[i];
                ids[i] = node.id();
                selfSizes[i] = node.selfSize();
            }

            this._aggregatesForDiff[className] = {
                indexes: indexes,
                ids: ids,
                selfSizes: selfSizes
            };
        }
        return this._aggregatesForDiff;
    },

    /**
     * @param {!WebInspector.HeapSnapshotNode} node
     * @return {!boolean}
     */
    _isUserRoot: function(node)
    {
        return true;
    },

    /**
     * @param {function(!WebInspector.HeapSnapshotNode)} action
     * @param {boolean=} userRootsOnly
     */
    forEachRoot: function(action, userRootsOnly)
    {
        for (var iter = this.rootNode().edges(); iter.hasNext(); iter.next()) {
            var node = iter.edge.node();
            if (!userRootsOnly || this._isUserRoot(node))
                action(node);
        }
    },

    _calculateDistances: function()
    {
        var nodeFieldCount = this._nodeFieldCount;
        var nodeCount = this.nodeCount;
        var distances = new Int32Array(nodeCount);
        var noDistance = this._noDistance;
        for (var i = 0; i < nodeCount; ++i)
            distances[i] = noDistance;

        var nodesToVisit = new Uint32Array(this.nodeCount);
        var nodesToVisitLength = 0;

        /**
         * @param {!WebInspector.HeapSnapshotNode} node
         */
        function enqueueNode(node)
        {
            var ordinal = node._ordinal();
            if (distances[ordinal] !== noDistance)
                return;
            distances[ordinal] = 0;
            nodesToVisit[nodesToVisitLength++] = node.nodeIndex;
        }

        this.forEachRoot(enqueueNode, true);
        this._bfs(nodesToVisit, nodesToVisitLength, distances);

        // bfs for the rest of objects
        nodesToVisitLength = 0;
        this.forEachRoot(enqueueNode);
        this._bfs(nodesToVisit, nodesToVisitLength, distances);

        this._nodeDistances = distances;
    },

    /**
     * @param {!Uint32Array} nodesToVisit
     * @param {!number} nodesToVisitLength
     * @param {!Int32Array} distances
     */
    _bfs: function(nodesToVisit, nodesToVisitLength, distances)
    {
        // Preload fields into local variables for better performance.
        var edgeFieldsCount = this._edgeFieldsCount;
        var nodeFieldCount = this._nodeFieldCount;
        var containmentEdges = this._containmentEdges;
        var firstEdgeIndexes = this._firstEdgeIndexes;
        var edgeToNodeOffset = this._edgeToNodeOffset;
        var edgeTypeOffset = this._edgeTypeOffset;
        var nodeCount = this.nodeCount;
        var containmentEdgesLength = containmentEdges.length;
        var edgeWeakType = this._edgeWeakType;
        var noDistance = this._noDistance;

        var index = 0;
        while (index < nodesToVisitLength) {
            var nodeIndex = nodesToVisit[index++]; // shift generates too much garbage.
            var nodeOrdinal = nodeIndex / nodeFieldCount;
            var distance = distances[nodeOrdinal] + 1;
            var firstEdgeIndex = firstEdgeIndexes[nodeOrdinal];
            var edgesEnd = firstEdgeIndexes[nodeOrdinal + 1];
            for (var edgeIndex = firstEdgeIndex; edgeIndex < edgesEnd; edgeIndex += edgeFieldsCount) {
                var edgeType = containmentEdges[edgeIndex + edgeTypeOffset];
                if (edgeType == edgeWeakType)
                    continue;
                var childNodeIndex = containmentEdges[edgeIndex + edgeToNodeOffset];
                var childNodeOrdinal = childNodeIndex / nodeFieldCount;
                if (distances[childNodeOrdinal] !== noDistance)
                    continue;
                distances[childNodeOrdinal] = distance;
                nodesToVisit[nodesToVisitLength++] = childNodeIndex;
            }
        }
        if (nodesToVisitLength > nodeCount)
            throw new Error("BFS failed. Nodes to visit (" + nodesToVisitLength + ") is more than nodes count (" + nodeCount + ")");
    },

    _buildAggregates: function(filter)
    {
        var aggregates = {};
        var aggregatesByClassName = {};
        var classIndexes = [];
        var nodes = this._nodes;
        var mapAndFlag = this.userObjectsMapAndFlag();
        var flags = mapAndFlag ? mapAndFlag.map : null;
        var flag = mapAndFlag ? mapAndFlag.flag : 0;
        var nodesLength = nodes.length;
        var nodeNativeType = this._nodeNativeType;
        var nodeFieldCount = this._nodeFieldCount;
        var selfSizeOffset = this._nodeSelfSizeOffset;
        var nodeTypeOffset = this._nodeTypeOffset;
        var node = this.rootNode();
        var nodeDistances = this._nodeDistances;

        for (var nodeIndex = 0; nodeIndex < nodesLength; nodeIndex += nodeFieldCount) {
            var nodeOrdinal = nodeIndex / nodeFieldCount;
            if (flags && !(flags[nodeOrdinal] & flag))
                continue;
            node.nodeIndex = nodeIndex;
            if (filter && !filter(node))
                continue;
            var selfSize = nodes[nodeIndex + selfSizeOffset];
            if (!selfSize && nodes[nodeIndex + nodeTypeOffset] !== nodeNativeType)
                continue;
            var classIndex = node.classIndex();
            if (!(classIndex in aggregates)) {
                var nodeType = node.type();
                var nameMatters = nodeType === "object" || nodeType === "native";
                var value = {
                    count: 1,
                    distance: nodeDistances[nodeOrdinal],
                    self: selfSize,
                    maxRet: 0,
                    type: nodeType,
                    name: nameMatters ? node.name() : null,
                    idxs: [nodeIndex]
                };
                aggregates[classIndex] = value;
                classIndexes.push(classIndex);
                aggregatesByClassName[node.className()] = value;
            } else {
                var clss = aggregates[classIndex];
                clss.distance = Math.min(clss.distance, nodeDistances[nodeOrdinal]);
                ++clss.count;
                clss.self += selfSize;
                clss.idxs.push(nodeIndex);
            }
        }

        // Shave off provisionally allocated space.
        for (var i = 0, l = classIndexes.length; i < l; ++i) {
            var classIndex = classIndexes[i];
            aggregates[classIndex].idxs = aggregates[classIndex].idxs.slice();
        }
        return {aggregatesByClassName: aggregatesByClassName, aggregatesByClassIndex: aggregates};
    },

    _calculateClassesRetainedSize: function(aggregates, filter)
    {
        var rootNodeIndex = this._rootNodeIndex;
        var node = this.createNode(rootNodeIndex);
        var list = [rootNodeIndex];
        var sizes = [-1];
        var classes = [];
        var seenClassNameIndexes = {};
        var nodeFieldCount = this._nodeFieldCount;
        var nodeTypeOffset = this._nodeTypeOffset;
        var nodeNativeType = this._nodeNativeType;
        var dominatedNodes = this._dominatedNodes;
        var nodes = this._nodes;
        var mapAndFlag = this.userObjectsMapAndFlag();
        var flags = mapAndFlag ? mapAndFlag.map : null;
        var flag = mapAndFlag ? mapAndFlag.flag : 0;
        var firstDominatedNodeIndex = this._firstDominatedNodeIndex;

        while (list.length) {
            var nodeIndex = list.pop();
            node.nodeIndex = nodeIndex;
            var classIndex = node.classIndex();
            var seen = !!seenClassNameIndexes[classIndex];
            var nodeOrdinal = nodeIndex / nodeFieldCount;
            var dominatedIndexFrom = firstDominatedNodeIndex[nodeOrdinal];
            var dominatedIndexTo = firstDominatedNodeIndex[nodeOrdinal + 1];

            if (!seen &&
                (!flags || (flags[nodeOrdinal] & flag)) &&
                (!filter || filter(node)) &&
                (node.selfSize() || nodes[nodeIndex + nodeTypeOffset] === nodeNativeType)
               ) {
                aggregates[classIndex].maxRet += node.retainedSize();
                if (dominatedIndexFrom !== dominatedIndexTo) {
                    seenClassNameIndexes[classIndex] = true;
                    sizes.push(list.length);
                    classes.push(classIndex);
                }
            }
            for (var i = dominatedIndexFrom; i < dominatedIndexTo; i++)
                list.push(dominatedNodes[i]);

            var l = list.length;
            while (sizes[sizes.length - 1] === l) {
                sizes.pop();
                classIndex = classes.pop();
                seenClassNameIndexes[classIndex] = false;
            }
        }
    },

    _sortAggregateIndexes: function(aggregates)
    {
        var nodeA = this.createNode();
        var nodeB = this.createNode();
        for (var clss in aggregates)
            aggregates[clss].idxs.sort(
                function(idxA, idxB) {
                    nodeA.nodeIndex = idxA;
                    nodeB.nodeIndex = idxB;
                    return nodeA.id() < nodeB.id() ? -1 : 1;
                });
    },

    _buildPostOrderIndex: function()
    {
        var nodeFieldCount = this._nodeFieldCount;
        var nodes = this._nodes;
        var nodeCount = this.nodeCount;
        var rootNodeOrdinal = this._rootNodeIndex / nodeFieldCount;

        var edgeFieldsCount = this._edgeFieldsCount;
        var edgeTypeOffset = this._edgeTypeOffset;
        var edgeToNodeOffset = this._edgeToNodeOffset;
        var edgeShortcutType = this._edgeShortcutType;
        var firstEdgeIndexes = this._firstEdgeIndexes;
        var containmentEdges = this._containmentEdges;
        var containmentEdgesLength = this._containmentEdges.length;

        var mapAndFlag = this.userObjectsMapAndFlag();
        var flags = mapAndFlag ? mapAndFlag.map : null;
        var flag = mapAndFlag ? mapAndFlag.flag : 0;

        var nodesToVisit = new Uint32Array(nodeCount);
        var postOrderIndex2NodeOrdinal = new Uint32Array(nodeCount);
        var nodeOrdinal2PostOrderIndex = new Uint32Array(nodeCount);
        var painted = new Uint8Array(nodeCount);
        var nodesToVisitLength = 0;
        var postOrderIndex = 0;
        var grey = 1;
        var black = 2;

        nodesToVisit[nodesToVisitLength++] = rootNodeOrdinal;
        painted[rootNodeOrdinal] = grey;

        while (nodesToVisitLength) {
            var nodeOrdinal = nodesToVisit[nodesToVisitLength - 1];

            if (painted[nodeOrdinal] === grey) {
                painted[nodeOrdinal] = black;
                var nodeFlag = !flags || (flags[nodeOrdinal] & flag);
                var beginEdgeIndex = firstEdgeIndexes[nodeOrdinal];
                var endEdgeIndex = firstEdgeIndexes[nodeOrdinal + 1];
                for (var edgeIndex = beginEdgeIndex; edgeIndex < endEdgeIndex; edgeIndex += edgeFieldsCount) {
                    if (nodeOrdinal !== rootNodeOrdinal && containmentEdges[edgeIndex + edgeTypeOffset] === edgeShortcutType)
                        continue;
                    var childNodeIndex = containmentEdges[edgeIndex + edgeToNodeOffset];
                    var childNodeOrdinal = childNodeIndex / nodeFieldCount;
                    var childNodeFlag = !flags || (flags[childNodeOrdinal] & flag);
                    // We are skipping the edges from non-page-owned nodes to page-owned nodes.
                    // Otherwise the dominators for the objects that also were retained by debugger would be affected.
                    if (nodeOrdinal !== rootNodeOrdinal && childNodeFlag && !nodeFlag)
                        continue;
                    if (!painted[childNodeOrdinal]) {
                        painted[childNodeOrdinal] = grey;
                        nodesToVisit[nodesToVisitLength++] = childNodeOrdinal;
                    }
                }
            } else {
                nodeOrdinal2PostOrderIndex[nodeOrdinal] = postOrderIndex;
                postOrderIndex2NodeOrdinal[postOrderIndex++] = nodeOrdinal;
                --nodesToVisitLength;
            }
        }

        if (postOrderIndex !== nodeCount) {
            console.log("Error: Corrupted snapshot. " + (nodeCount - postOrderIndex) + " nodes are unreachable from the root:");
            var dumpNode = this.rootNode();
            for (var i = 0; i < nodeCount; ++i) {
                if (painted[i] !== black) {
                    // Fix it by giving the node a postorder index anyway.
                    nodeOrdinal2PostOrderIndex[i] = postOrderIndex;
                    postOrderIndex2NodeOrdinal[postOrderIndex++] = i;
                    dumpNode.nodeIndex = i * nodeFieldCount;
                    console.log(JSON.stringify(dumpNode.serialize()));
                    for (var retainers = dumpNode.retainers(); retainers.hasNext(); retainers = retainers.item().node().retainers())
                        console.log("  edgeName: " + retainers.item().name() + " nodeClassName: " + retainers.item().node().className());
                }
            }
        }

        return {postOrderIndex2NodeOrdinal: postOrderIndex2NodeOrdinal, nodeOrdinal2PostOrderIndex: nodeOrdinal2PostOrderIndex};
    },

    // The algorithm is based on the article:
    // K. Cooper, T. Harvey and K. Kennedy "A Simple, Fast Dominance Algorithm"
    // Softw. Pract. Exper. 4 (2001), pp. 1-10.
    /**
     * @param {!Array.<number>} postOrderIndex2NodeOrdinal
     * @param {!Array.<number>} nodeOrdinal2PostOrderIndex
     */
    _buildDominatorTree: function(postOrderIndex2NodeOrdinal, nodeOrdinal2PostOrderIndex)
    {
        var nodeFieldCount = this._nodeFieldCount;
        var nodes = this._nodes;
        var firstRetainerIndex = this._firstRetainerIndex;
        var retainingNodes = this._retainingNodes;
        var retainingEdges = this._retainingEdges;
        var edgeFieldsCount = this._edgeFieldsCount;
        var edgeTypeOffset = this._edgeTypeOffset;
        var edgeToNodeOffset = this._edgeToNodeOffset;
        var edgeShortcutType = this._edgeShortcutType;
        var firstEdgeIndexes = this._firstEdgeIndexes;
        var containmentEdges = this._containmentEdges;
        var containmentEdgesLength = this._containmentEdges.length;
        var rootNodeIndex = this._rootNodeIndex;

        var mapAndFlag = this.userObjectsMapAndFlag();
        var flags = mapAndFlag ? mapAndFlag.map : null;
        var flag = mapAndFlag ? mapAndFlag.flag : 0;

        var nodesCount = postOrderIndex2NodeOrdinal.length;
        var rootPostOrderedIndex = nodesCount - 1;
        var noEntry = nodesCount;
        var dominators = new Uint32Array(nodesCount);
        for (var i = 0; i < rootPostOrderedIndex; ++i)
            dominators[i] = noEntry;
        dominators[rootPostOrderedIndex] = rootPostOrderedIndex;

        // The affected array is used to mark entries which dominators
        // have to be racalculated because of changes in their retainers.
        var affected = new Uint8Array(nodesCount);
        var nodeOrdinal;

        { // Mark the root direct children as affected.
            nodeOrdinal = this._rootNodeIndex / nodeFieldCount;
            var beginEdgeToNodeFieldIndex = firstEdgeIndexes[nodeOrdinal] + edgeToNodeOffset;
            var endEdgeToNodeFieldIndex = firstEdgeIndexes[nodeOrdinal + 1];
            for (var toNodeFieldIndex = beginEdgeToNodeFieldIndex;
                 toNodeFieldIndex < endEdgeToNodeFieldIndex;
                 toNodeFieldIndex += edgeFieldsCount) {
                var childNodeOrdinal = containmentEdges[toNodeFieldIndex] / nodeFieldCount;
                affected[nodeOrdinal2PostOrderIndex[childNodeOrdinal]] = 1;
            }
        }

        var changed = true;
        while (changed) {
            changed = false;
            for (var postOrderIndex = rootPostOrderedIndex - 1; postOrderIndex >= 0; --postOrderIndex) {
                if (affected[postOrderIndex] === 0)
                    continue;
                affected[postOrderIndex] = 0;
                // If dominator of the entry has already been set to root,
                // then it can't propagate any further.
                if (dominators[postOrderIndex] === rootPostOrderedIndex)
                    continue;
                nodeOrdinal = postOrderIndex2NodeOrdinal[postOrderIndex];
                var nodeFlag = !flags || (flags[nodeOrdinal] & flag);
                var newDominatorIndex = noEntry;
                var beginRetainerIndex = firstRetainerIndex[nodeOrdinal];
                var endRetainerIndex = firstRetainerIndex[nodeOrdinal + 1];
                for (var retainerIndex = beginRetainerIndex; retainerIndex < endRetainerIndex; ++retainerIndex) {
                    var retainerEdgeIndex = retainingEdges[retainerIndex];
                    var retainerEdgeType = containmentEdges[retainerEdgeIndex + edgeTypeOffset];
                    var retainerNodeIndex = retainingNodes[retainerIndex];
                    if (retainerNodeIndex !== rootNodeIndex && retainerEdgeType === edgeShortcutType)
                        continue;
                    var retainerNodeOrdinal = retainerNodeIndex / nodeFieldCount;
                    var retainerNodeFlag = !flags || (flags[retainerNodeOrdinal] & flag);
                    // We are skipping the edges from non-page-owned nodes to page-owned nodes.
                    // Otherwise the dominators for the objects that also were retained by debugger would be affected.
                    if (retainerNodeIndex !== rootNodeIndex && nodeFlag && !retainerNodeFlag)
                        continue;
                    var retanerPostOrderIndex = nodeOrdinal2PostOrderIndex[retainerNodeOrdinal];
                    if (dominators[retanerPostOrderIndex] !== noEntry) {
                        if (newDominatorIndex === noEntry)
                            newDominatorIndex = retanerPostOrderIndex;
                        else {
                            while (retanerPostOrderIndex !== newDominatorIndex) {
                                while (retanerPostOrderIndex < newDominatorIndex)
                                    retanerPostOrderIndex = dominators[retanerPostOrderIndex];
                                while (newDominatorIndex < retanerPostOrderIndex)
                                    newDominatorIndex = dominators[newDominatorIndex];
                            }
                        }
                        // If idom has already reached the root, it doesn't make sense
                        // to check other retainers.
                        if (newDominatorIndex === rootPostOrderedIndex)
                            break;
                    }
                }
                if (newDominatorIndex !== noEntry && dominators[postOrderIndex] !== newDominatorIndex) {
                    dominators[postOrderIndex] = newDominatorIndex;
                    changed = true;
                    nodeOrdinal = postOrderIndex2NodeOrdinal[postOrderIndex];
                    beginEdgeToNodeFieldIndex = firstEdgeIndexes[nodeOrdinal] + edgeToNodeOffset;
                    endEdgeToNodeFieldIndex = firstEdgeIndexes[nodeOrdinal + 1];
                    for (var toNodeFieldIndex = beginEdgeToNodeFieldIndex;
                         toNodeFieldIndex < endEdgeToNodeFieldIndex;
                         toNodeFieldIndex += edgeFieldsCount) {
                        var childNodeOrdinal = containmentEdges[toNodeFieldIndex] / nodeFieldCount;
                        affected[nodeOrdinal2PostOrderIndex[childNodeOrdinal]] = 1;
                    }
                }
            }
        }

        var dominatorsTree = new Uint32Array(nodesCount);
        for (var postOrderIndex = 0, l = dominators.length; postOrderIndex < l; ++postOrderIndex) {
            nodeOrdinal = postOrderIndex2NodeOrdinal[postOrderIndex];
            dominatorsTree[nodeOrdinal] = postOrderIndex2NodeOrdinal[dominators[postOrderIndex]];
        }
        return dominatorsTree;
    },

    _calculateRetainedSizes: function(postOrderIndex2NodeOrdinal)
    {
        var nodeCount = this.nodeCount;
        var nodes = this._nodes;
        var nodeSelfSizeOffset = this._nodeSelfSizeOffset;
        var nodeFieldCount = this._nodeFieldCount;
        var dominatorsTree = this._dominatorsTree;
        var retainedSizes = this._retainedSizes = new Float64Array(nodeCount);

        for (var nodeOrdinal = 0; nodeOrdinal < nodeCount; ++nodeOrdinal)
            retainedSizes[nodeOrdinal] = nodes[nodeOrdinal * nodeFieldCount + nodeSelfSizeOffset];

        // Propagate retained sizes for each node excluding root.
        for (var postOrderIndex = 0; postOrderIndex < nodeCount - 1; ++postOrderIndex) {
            var nodeOrdinal = postOrderIndex2NodeOrdinal[postOrderIndex];
            var dominatorOrdinal = dominatorsTree[nodeOrdinal];
            retainedSizes[dominatorOrdinal] += retainedSizes[nodeOrdinal];
        }
    },

    _buildDominatedNodes: function()
    {
        // Builds up two arrays:
        //  - "dominatedNodes" is a continuous array, where each node owns an
        //    interval (can be empty) with corresponding dominated nodes.
        //  - "indexArray" is an array of indexes in the "dominatedNodes"
        //    with the same positions as in the _nodeIndex.
        var indexArray = this._firstDominatedNodeIndex = new Uint32Array(this.nodeCount + 1);
        // All nodes except the root have dominators.
        var dominatedNodes = this._dominatedNodes = new Uint32Array(this.nodeCount - 1);

        // Count the number of dominated nodes for each node. Skip the root (node at
        // index 0) as it is the only node that dominates itself.
        var nodeFieldCount = this._nodeFieldCount;
        var dominatorsTree = this._dominatorsTree;

        var fromNodeOrdinal = 0;
        var toNodeOrdinal = this.nodeCount;
        var rootNodeOrdinal = this._rootNodeIndex / nodeFieldCount;
        if (rootNodeOrdinal === fromNodeOrdinal)
            fromNodeOrdinal = 1;
        else if (rootNodeOrdinal === toNodeOrdinal - 1)
            toNodeOrdinal = toNodeOrdinal - 1;
        else
            throw new Error("Root node is expected to be either first or last");
        for (var nodeOrdinal = fromNodeOrdinal; nodeOrdinal < toNodeOrdinal; ++nodeOrdinal)
            ++indexArray[dominatorsTree[nodeOrdinal]];
        // Put in the first slot of each dominatedNodes slice the count of entries
        // that will be filled.
        var firstDominatedNodeIndex = 0;
        for (var i = 0, l = this.nodeCount; i < l; ++i) {
            var dominatedCount = dominatedNodes[firstDominatedNodeIndex] = indexArray[i];
            indexArray[i] = firstDominatedNodeIndex;
            firstDominatedNodeIndex += dominatedCount;
        }
        indexArray[this.nodeCount] = dominatedNodes.length;
        // Fill up the dominatedNodes array with indexes of dominated nodes. Skip the root (node at
        // index 0) as it is the only node that dominates itself.
        for (var nodeOrdinal = fromNodeOrdinal; nodeOrdinal < toNodeOrdinal; ++nodeOrdinal) {
            var dominatorOrdinal = dominatorsTree[nodeOrdinal];
            var dominatedRefIndex = indexArray[dominatorOrdinal];
            dominatedRefIndex += (--dominatedNodes[dominatedRefIndex]);
            dominatedNodes[dominatedRefIndex] = nodeOrdinal * nodeFieldCount;
        }
    },

    _markInvisibleEdges: function()
    {
        throw new Error("Not implemented");
    },

    _calculateFlags: function()
    {
        throw new Error("Not implemented");
    },

    _calculateStatistics: function()
    {
        throw new Error("Not implemented");
    },

    userObjectsMapAndFlag: function()
    {
        throw new Error("Not implemented");
    },

    /**
     * @param {string} baseSnapshotId
     * @param {!Object.<string, !WebInspector.HeapSnapshotCommon.AggregateForDiff>} baseSnapshotAggregates
     * @return {!Object.<string, !WebInspector.HeapSnapshotCommon.Diff>}
     */
    calculateSnapshotDiff: function(baseSnapshotId, baseSnapshotAggregates)
    {
        var snapshotDiff = this._snapshotDiffs[baseSnapshotId];
        if (snapshotDiff)
            return snapshotDiff;
        snapshotDiff = {};

        var aggregates = this.aggregates(true, "allObjects");
        for (var className in baseSnapshotAggregates) {
            var baseAggregate = baseSnapshotAggregates[className];
            var diff = this._calculateDiffForClass(baseAggregate, aggregates[className]);
            if (diff)
                snapshotDiff[className] = diff;
        }
        var emptyBaseAggregate = new WebInspector.HeapSnapshotCommon.AggregateForDiff();
        for (var className in aggregates) {
            if (className in baseSnapshotAggregates)
                continue;
            snapshotDiff[className] = this._calculateDiffForClass(emptyBaseAggregate, aggregates[className]);
        }

        this._snapshotDiffs[baseSnapshotId] = snapshotDiff;
        return snapshotDiff;
    },

    /**
     * @param {!WebInspector.HeapSnapshotCommon.AggregateForDiff} baseAggregate
     * @param {!WebInspector.HeapSnapshotCommon.Aggregate} aggregate
     * @return {?WebInspector.HeapSnapshotCommon.Diff}
     */
    _calculateDiffForClass: function(baseAggregate, aggregate)
    {
        var baseIds = baseAggregate.ids;
        var baseIndexes = baseAggregate.indexes;
        var baseSelfSizes = baseAggregate.selfSizes;

        var indexes = aggregate ? aggregate.idxs : [];

        var i = 0, l = baseIds.length;
        var j = 0, m = indexes.length;
        var diff = new WebInspector.HeapSnapshotCommon.Diff();

        var nodeB = this.createNode(indexes[j]);
        while (i < l && j < m) {
            var nodeAId = baseIds[i];
            if (nodeAId < nodeB.id()) {
                diff.deletedIndexes.push(baseIndexes[i]);
                diff.removedCount++;
                diff.removedSize += baseSelfSizes[i];
                ++i;
            } else if (nodeAId > nodeB.id()) { // Native nodes(e.g. dom groups) may have ids less than max JS object id in the base snapshot
                diff.addedIndexes.push(indexes[j]);
                diff.addedCount++;
                diff.addedSize += nodeB.selfSize();
                nodeB.nodeIndex = indexes[++j];
            } else { // nodeAId === nodeB.id()
                ++i;
                nodeB.nodeIndex = indexes[++j];
            }
        }
        while (i < l) {
            diff.deletedIndexes.push(baseIndexes[i]);
            diff.removedCount++;
            diff.removedSize += baseSelfSizes[i];
            ++i;
        }
        while (j < m) {
            diff.addedIndexes.push(indexes[j]);
            diff.addedCount++;
            diff.addedSize += nodeB.selfSize();
            nodeB.nodeIndex = indexes[++j];
        }
        diff.countDelta = diff.addedCount - diff.removedCount;
        diff.sizeDelta = diff.addedSize - diff.removedSize;
        if (!diff.addedCount && !diff.removedCount)
            return null;
        return diff;
    },

    _nodeForSnapshotObjectId: function(snapshotObjectId)
    {
        for (var it = this._allNodes(); it.hasNext(); it.next()) {
            if (it.node.id() === snapshotObjectId)
                return it.node;
        }
        return null;
    },

    /**
     * @param {string} snapshotObjectId
     * @return {?string}
     */
    nodeClassName: function(snapshotObjectId)
    {
        var node = this._nodeForSnapshotObjectId(snapshotObjectId);
        if (node)
            return node.className();
        return null;
    },

    /**
     * @param {string} name
     * @return {!Array.<number>}
     */
    idsOfObjectsWithName: function(name)
    {
        var ids = [];
        for (var it = this._allNodes(); it.hasNext(); it.next()) {
            if (it.item().name() === name)
                ids.push(it.item().id());
        }
        return ids;
    },

    /**
     * @param {string} snapshotObjectId
     * @return {?Array.<string>}
     */
    dominatorIdsForNode: function(snapshotObjectId)
    {
        var node = this._nodeForSnapshotObjectId(snapshotObjectId);
        if (!node)
            return null;
        var result = [];
        while (!node.isRoot()) {
            result.push(node.id());
            node.nodeIndex = node.dominatorIndex();
        }
        return result;
    },

    _parseFilter: function(filter)
    {
        if (!filter)
            return null;
        var parsedFilter = eval("(function(){return " + filter + "})()");
        return parsedFilter.bind(this);
    },

    /**
     * @param {number} nodeIndex
     * @param {boolean} showHiddenData
     * @return {!WebInspector.HeapSnapshotEdgesProvider}
     */
    createEdgesProvider: function(nodeIndex, showHiddenData)
    {
        var node = this.createNode(nodeIndex);
        var filter = this.containmentEdgesFilter(showHiddenData);
        return new WebInspector.HeapSnapshotEdgesProvider(this, filter, node.edges());
    },

    /**
     * @param {number} nodeIndex
     * @return {!WebInspector.HeapSnapshotEdgesProvider}
     */
    createEdgesProviderForTest: function(nodeIndex, filter)
    {
        var node = this.createNode(nodeIndex);
        return new WebInspector.HeapSnapshotEdgesProvider(this, filter, node.edges());
    },

    /**
     * @param {boolean} showHiddenData
     * @return {?function(!WebInspector.HeapSnapshotEdge):boolean}
     */
    retainingEdgesFilter: function(showHiddenData)
    {
        return null;
    },

    /**
     * @param {boolean} showHiddenData
     * @return {?function(!WebInspector.HeapSnapshotEdge):boolean}
     */
    containmentEdgesFilter: function(showHiddenData)
    {
        return null;
    },

    /**
     * @param {number} nodeIndex
     * @param {boolean} showHiddenData
     * @return {!WebInspector.HeapSnapshotEdgesProvider}
     */
    createRetainingEdgesProvider: function(nodeIndex, showHiddenData)
    {
        var node = this.createNode(nodeIndex);
        var filter = this.retainingEdgesFilter(showHiddenData);
        return new WebInspector.HeapSnapshotEdgesProvider(this, filter, node.retainers());
    },

    /**
     * @param {string} baseSnapshotId
     * @param {string} className
     * @return {!WebInspector.HeapSnapshotNodesProvider}
     */
    createAddedNodesProvider: function(baseSnapshotId, className)
    {
        var snapshotDiff = this._snapshotDiffs[baseSnapshotId];
        var diffForClass = snapshotDiff[className];
        return new WebInspector.HeapSnapshotNodesProvider(this, null, diffForClass.addedIndexes);
    },

    /**
     * @param {!Array.<number>} nodeIndexes
     * @return {!WebInspector.HeapSnapshotNodesProvider}
     */
    createDeletedNodesProvider: function(nodeIndexes)
    {
        return new WebInspector.HeapSnapshotNodesProvider(this, null, nodeIndexes);
    },

    /**
     * @return {?function(!WebInspector.HeapSnapshotNode):boolean}
     */
    classNodesFilter: function()
    {
        return null;
    },

    /**
     * @param {string} className
     * @param {!WebInspector.HeapSnapshotCommon.NodeFilter} nodeFilter
     * @return {!WebInspector.HeapSnapshotNodesProvider}
     */
    createNodesProviderForClass: function(className, nodeFilter)
    {
        return new WebInspector.HeapSnapshotNodesProvider(this, this.classNodesFilter(), this.aggregatesWithFilter(nodeFilter)[className].idxs);
    },

    /**
     * @param {number} nodeIndex
     * @return {!WebInspector.HeapSnapshotNodesProvider}
     */
    createNodesProviderForDominator: function(nodeIndex)
    {
        var node = this.createNode(nodeIndex);
        return new WebInspector.HeapSnapshotNodesProvider(this, null, this._dominatedNodesOfNode(node));
    },

    /**
     * @return {number}
     */
    _maxJsNodeId: function()
    {
        var nodeFieldCount = this._nodeFieldCount;
        var nodes = this._nodes;
        var nodesLength = nodes.length;
        var id = 0;
        for (var nodeIndex = this._nodeIdOffset; nodeIndex < nodesLength; nodeIndex += nodeFieldCount) {
            var nextId = nodes[nodeIndex];
            // JS objects have odd ids, skip native objects.
            if (nextId % 2 === 0)
                continue;
            if (id < nextId)
                id = nextId;
        }
        return id;
    },

    /**
     * @return {!WebInspector.HeapSnapshotCommon.StaticData}
     */
    updateStaticData: function()
    {
        return new WebInspector.HeapSnapshotCommon.StaticData(this.nodeCount, this._rootNodeIndex, this.totalSize, this._maxJsNodeId());
    }
};

/**
 * @constructor
 * @param {!Array.<number>=} unfilteredIterationOrder
 */
WebInspector.HeapSnapshotFilteredOrderedIterator = function(iterator, filter, unfilteredIterationOrder)
{
    this._filter = filter;
    this._iterator = iterator;
    this._unfilteredIterationOrder = unfilteredIterationOrder;
    this._iterationOrder = null;
    this._position = 0;
    this._currentComparator = null;
    this._sortedPrefixLength = 0;
    this._sortedSuffixLength = 0;
}

WebInspector.HeapSnapshotFilteredOrderedIterator.prototype = {
    _createIterationOrder: function()
    {
        if (this._iterationOrder)
            return;
        if (this._unfilteredIterationOrder && !this._filter) {
            this._iterationOrder = this._unfilteredIterationOrder.slice(0);
            this._unfilteredIterationOrder = null;
            return;
        }
        this._iterationOrder = [];
        var iterator = this._iterator;
        if (!this._unfilteredIterationOrder && !this._filter) {
            for (iterator.rewind(); iterator.hasNext(); iterator.next())
                this._iterationOrder.push(iterator.index());
        } else if (!this._unfilteredIterationOrder) {
            for (iterator.rewind(); iterator.hasNext(); iterator.next()) {
                if (this._filter(iterator.item()))
                    this._iterationOrder.push(iterator.index());
            }
        } else {
            var order = this._unfilteredIterationOrder.constructor === Array ?
                this._unfilteredIterationOrder : this._unfilteredIterationOrder.slice(0);
            for (var i = 0, l = order.length; i < l; ++i) {
                iterator.setIndex(order[i]);
                if (this._filter(iterator.item()))
                    this._iterationOrder.push(iterator.index());
            }
            this._unfilteredIterationOrder = null;
        }
    },

    rewind: function()
    {
        this._position = 0;
    },

    /**
     * @return {boolean}
     */
    hasNext: function()
    {
        return this._position < this._iterationOrder.length;
    },

    /**
     * @return {boolean}
     */
    isEmpty: function()
    {
        if (this._iterationOrder)
            return !this._iterationOrder.length;
        if (this._unfilteredIterationOrder && !this._filter)
            return !this._unfilteredIterationOrder.length;
        var iterator = this._iterator;
        if (!this._unfilteredIterationOrder && !this._filter) {
            iterator.rewind();
            return !iterator.hasNext();
        } else if (!this._unfilteredIterationOrder) {
            for (iterator.rewind(); iterator.hasNext(); iterator.next())
                if (this._filter(iterator.item()))
                    return false;
        } else {
            var order = this._unfilteredIterationOrder.constructor === Array ?
                this._unfilteredIterationOrder : this._unfilteredIterationOrder.slice(0);
            for (var i = 0, l = order.length; i < l; ++i) {
                iterator.setIndex(order[i]);
                if (this._filter(iterator.item()))
                    return false;
            }
        }
        return true;
    },

    /**
     * @return {*}
     */
    item: function()
    {
        this._iterator.setIndex(this._iterationOrder[this._position]);
        return this._iterator.item();
    },

    /**
     * @type {number}
     */
    get length()
    {
        this._createIterationOrder();
        return this._iterationOrder.length;
    },

    next: function()
    {
        ++this._position;
    },

    /**
     * @param {number} begin
     * @param {number} end
     * @return {!WebInspector.HeapSnapshotCommon.ItemsRange}
     */
    serializeItemsRange: function(begin, end)
    {
        this._createIterationOrder();
        if (begin > end)
            throw new Error("Start position > end position: " + begin + " > " + end);
        if (end > this._iterationOrder.length)
            end = this._iterationOrder.length;
        if (this._sortedPrefixLength < end && begin < this._iterationOrder.length - this._sortedSuffixLength) {
            this.sort(this._currentComparator, this._sortedPrefixLength, this._iterationOrder.length - 1 - this._sortedSuffixLength, begin, end - 1);
            if (begin <= this._sortedPrefixLength)
                this._sortedPrefixLength = end;
            if (end >= this._iterationOrder.length - this._sortedSuffixLength)
                this._sortedSuffixLength = this._iterationOrder.length - begin;
        }

        this._position = begin;
        var startPosition = this._position;
        var count = end - begin;
        var result = new Array(count);
        for (var i = 0 ; i < count && this.hasNext(); ++i, this.next())
            result[i] = this.item().serialize();
        return new WebInspector.HeapSnapshotCommon.ItemsRange(startPosition, this._position, this._iterationOrder.length, result);
    },

    sortAndRewind: function(comparator)
    {
        this._currentComparator = comparator;
        this._sortedPrefixLength = 0;
        this._sortedSuffixLength = 0;
        this.rewind();
    }
}

/**
 * @constructor
 * @extends {WebInspector.HeapSnapshotFilteredOrderedIterator}
 */
WebInspector.HeapSnapshotEdgesProvider = function(snapshot, filter, edgesIter)
{
    this.snapshot = snapshot;
    WebInspector.HeapSnapshotFilteredOrderedIterator.call(this, edgesIter, filter);
}

WebInspector.HeapSnapshotEdgesProvider.prototype = {
    /**
     * @param {!WebInspector.HeapSnapshotCommon.ComparatorConfig} comparator
     * @param {number} leftBound
     * @param {number} rightBound
     * @param {number} windowLeft
     * @param {number} windowRight
     */
    sort: function(comparator, leftBound, rightBound, windowLeft, windowRight)
    {
        var fieldName1 = comparator.fieldName1;
        var fieldName2 = comparator.fieldName2;
        var ascending1 = comparator.ascending1;
        var ascending2 = comparator.ascending2;

        var edgeA = this._iterator.item().clone();
        var edgeB = edgeA.clone();
        var nodeA = this.snapshot.createNode();
        var nodeB = this.snapshot.createNode();

        function compareEdgeFieldName(ascending, indexA, indexB)
        {
            edgeA.edgeIndex = indexA;
            edgeB.edgeIndex = indexB;
            if (edgeB.name() === "__proto__") return -1;
            if (edgeA.name() === "__proto__") return 1;
            var result =
                edgeA.hasStringName() === edgeB.hasStringName() ?
                (edgeA.name() < edgeB.name() ? -1 : (edgeA.name() > edgeB.name() ? 1 : 0)) :
                (edgeA.hasStringName() ? -1 : 1);
            return ascending ? result : -result;
        }

        function compareNodeField(fieldName, ascending, indexA, indexB)
        {
            edgeA.edgeIndex = indexA;
            nodeA.nodeIndex = edgeA.nodeIndex();
            var valueA = nodeA[fieldName]();

            edgeB.edgeIndex = indexB;
            nodeB.nodeIndex = edgeB.nodeIndex();
            var valueB = nodeB[fieldName]();

            var result = valueA < valueB ? -1 : (valueA > valueB ? 1 : 0);
            return ascending ? result : -result;
        }

        function compareEdgeAndNode(indexA, indexB) {
            var result = compareEdgeFieldName(ascending1, indexA, indexB);
            if (result === 0)
                result = compareNodeField(fieldName2, ascending2, indexA, indexB);
            if (result === 0)
                return indexA - indexB;
            return result;
        }

        function compareNodeAndEdge(indexA, indexB) {
            var result = compareNodeField(fieldName1, ascending1, indexA, indexB);
            if (result === 0)
                result = compareEdgeFieldName(ascending2, indexA, indexB);
            if (result === 0)
                return indexA - indexB;
            return result;
        }

        function compareNodeAndNode(indexA, indexB) {
            var result = compareNodeField(fieldName1, ascending1, indexA, indexB);
            if (result === 0)
                result = compareNodeField(fieldName2, ascending2, indexA, indexB);
            if (result === 0)
                return indexA - indexB;
            return result;
        }

        if (fieldName1 === "!edgeName")
            this._iterationOrder.sortRange(compareEdgeAndNode, leftBound, rightBound, windowLeft, windowRight);
        else if (fieldName2 === "!edgeName")
            this._iterationOrder.sortRange(compareNodeAndEdge, leftBound, rightBound, windowLeft, windowRight);
        else
            this._iterationOrder.sortRange(compareNodeAndNode, leftBound, rightBound, windowLeft, windowRight);
    },

    __proto__: WebInspector.HeapSnapshotFilteredOrderedIterator.prototype
}


/**
 * @constructor
 * @extends {WebInspector.HeapSnapshotFilteredOrderedIterator}
 * @param {!Array.<number>=} nodeIndexes
 */
WebInspector.HeapSnapshotNodesProvider = function(snapshot, filter, nodeIndexes)
{
    this.snapshot = snapshot;
    WebInspector.HeapSnapshotFilteredOrderedIterator.call(this, snapshot._allNodes(), filter, nodeIndexes);
}

WebInspector.HeapSnapshotNodesProvider.prototype = {
    /**
     * @param {string} snapshotObjectId
     * @return {number}
     */
    nodePosition: function(snapshotObjectId)
    {
        this._createIterationOrder();
        var node = this.snapshot.createNode();
        for (var i = 0; i < this._iterationOrder.length; i++) {
            node.nodeIndex = this._iterationOrder[i];
            if (node.id() === snapshotObjectId)
                break;
        }
        if (i === this._iterationOrder.length)
            return -1;
        var targetNodeIndex = this._iterationOrder[i];
        var smallerCount = 0;
        var compare = this._buildCompareFunction(this._currentComparator);
        for (var i = 0; i < this._iterationOrder.length; i++) {
            if (compare(this._iterationOrder[i], targetNodeIndex) < 0)
                ++smallerCount;
        }
        return smallerCount;
    },

    /**
     * @return {function(number,number):number}
     */
    _buildCompareFunction: function(comparator)
    {
        var nodeA = this.snapshot.createNode();
        var nodeB = this.snapshot.createNode();
        var fieldAccessor1 = nodeA[comparator.fieldName1];
        var fieldAccessor2 = nodeA[comparator.fieldName2];
        var ascending1 = comparator.ascending1 ? 1 : -1;
        var ascending2 = comparator.ascending2 ? 1 : -1;

        /**
         * @param {function():*} fieldAccessor
         * @param {number} ascending
         * @return {number}
         */
        function sortByNodeField(fieldAccessor, ascending)
        {
            var valueA = fieldAccessor.call(nodeA);
            var valueB = fieldAccessor.call(nodeB);
            return valueA < valueB ? -ascending : (valueA > valueB ? ascending : 0);
        }

        /**
         * @param {number} indexA
         * @param {number} indexB
         * @return {number}
         */
        function sortByComparator(indexA, indexB)
        {
            nodeA.nodeIndex = indexA;
            nodeB.nodeIndex = indexB;
            var result = sortByNodeField(fieldAccessor1, ascending1);
            if (result === 0)
                result = sortByNodeField(fieldAccessor2, ascending2);
            return result || indexA - indexB;
        }

        return sortByComparator;
    },

    /**
     * @param {number} leftBound
     * @param {number} rightBound
     * @param {number} windowLeft
     * @param {number} windowRight
     */
    sort: function(comparator, leftBound, rightBound, windowLeft, windowRight)
    {
        this._iterationOrder.sortRange(this._buildCompareFunction(comparator), leftBound, rightBound, windowLeft, windowRight);
    },

    __proto__: WebInspector.HeapSnapshotFilteredOrderedIterator.prototype
}

