/**
 * Segment annotation widget.
 *
 * var annotator = new SegmentAnnotator("/path/to/image.jpg", {
 *   onload: function () {},
 *   onerror: function () {},
 *   onchange: function () {},
 *   onrightclick: function () {},
 *   onleftclick: function () {}
 * });
 * document.body.appendChild(annotator.container);
 *
 * Copyright 2015  Kota Yamaguchi
 */
define(['../image/layer',
        '../image/segmentation',
        '../image/morph'],
function(Layer, segmentation, morph) {
  // Segment annotator.
  function Annotator(imageURL, options) {
    options = options || {};
    if (typeof imageURL !== "string")
      throw "Invalid imageURL";
    this.colormap = options.colormap || [[255, 255, 255], [255, 0, 0]];
    this.boundaryAlpha = options.boundaryAlpha || 127;
    this.visualizationAlpha = options.visualizationAlpha || 144;
    this.highlightAlpha = options.highlightAlpha ||
                          Math.min(255, this.visualizationAlpha + 128);
    this.currentZoom = 1.0;
    this.defaultLabel = options.defaultLabel || 0;
    this.maxHistoryRecord = options.maxHistoryRecord || 10;
    this.onchange = options.onchange || null;
    this.onrightclick = options.onrightclick || null;
    this.onleftclick = options.onleftclick || null;
    this._createLayers(options);
    this._initializeHistory(options);
    var annotator = this;
    this.layers.image.load(imageURL, {
      width: options.width,
      height: options.height,
      onload: function () { annotator._initialize(options); },
      onerror: options.onerror
    });
  }

  // Run superpixel segmentation.
  Annotator.prototype.resetSuperpixels = function (options) {
    options = options || {};
    this.layers.superpixel.copy(this.layers.image);
    this.segmentation = segmentation.create(this.layers.image.imageData,
                                            options);
    this._updateSuperpixels(options);
    return this;
  };

  // Adjust the superpixel resolution.
  Annotator.prototype.finer = function (options) {
    this.segmentation.finer();
    this._updateSuperpixels(options);
    return this;
  };

  // Adjust the superpixel resolution.
  Annotator.prototype.coarser = function (options) {
    this.segmentation.coarser();
    this._updateSuperpixels(options);
    return this;
  };

  // Undo the edit.
  Annotator.prototype.undo = function () {
    if (this.currentHistoryRecord < 0)
      return false;
    var record = this.history[this.currentHistoryRecord--];
    this._fillPixels(record.pixels, record.prev);
    this.layers.visualization.render();
    if (typeof this.onchange === "function")
      this.onchange.call(this);
    return this.currentHistoryRecord < 0;
  };

  // Redo the edit.
  Annotator.prototype.redo = function () {
    if (this.currentHistoryRecord >= this.history.length - 1)
      return false;
    var record = this.history[++this.currentHistoryRecord];
    this._fillPixels(record.pixels, record.next);
    this.layers.visualization.render();
    if (typeof this.onchange === "function")
      this.onchange.call(this);
    return this.currentHistoryRecord >= this.history.length;
  };

  // Get unique labels in the current annotation.
  Annotator.prototype.getUniqueLabels = function () {
    var uniqueIndex = [],
        data = this.layers.annotation.imageData.data;
    for (var i = 0; i < data.length; i += 4) {
      var label = _getEncodedLabel(data, i);
      if (uniqueIndex.indexOf(label) < 0) {
        uniqueIndex.push(label);
      }
    }
    return uniqueIndex.sort(function (a, b) { return a - b; });
  };

  // Fill all the pixels assigned the target label or all.
  Annotator.prototype.fill = function (targetLabel) {
    var pixels = [],
        annotationData = this.layers.annotation.imageData.data;
    for (var i = 0; i < annotationData.length; i += 4) {
      var label = _getEncodedLabel(annotationData, i);
      if (label === targetLabel || targetLabel === undefined)
        pixels.push(i);
    }
    if (pixels.length > 0)
      this._updateAnnotation(pixels, this.currentLabel);
    return this;
  };

  Annotator.prototype.setAlpha = function (alpha) {
    this.visualizationAlpha = Math.max(Math.min(alpha, 255), 0);
    this.layers.visualization.setAlpha(this.visualizationAlpha).render();
    return this;
  };

  Annotator.prototype.lessAlpha = function (scale) {
    return this.setAlpha(this.visualizationAlpha - (scale || 1) * 20);
  };

  Annotator.prototype.moreAlpha = function (scale) {
    return this.setAlpha(this.visualizationAlpha + (scale || 1) * 20);
  };

  // Import an existing annotation.
  Annotator.prototype.import = function (annotationURL, options) {
    options = options || {};
    var annotator = this;
    this.layers.annotation.load(annotationURL, {
      onload: function () {
        if (options.grayscale)
          this.gray2index();
        annotator.layers
                 .visualization
                 .copy(this)
                 .applyColormap(annotator.colormap)
                 .setAlpha(annotator.visualizationAlpha)
                 .render();
        this.setAlpha(0).render();
        this.history = [];
        this.currentHistoryRecord = -1;
        if (typeof options.onload === "function")
          options.onload.call(annotator);
        if (typeof annotator.onchange === "function")
          annotator.onchange.call(annotator);
      },
      onerror: options.onerror
    });
    return this;
  };

  // Export the annotation in data URL.
  Annotator.prototype.export = function () {
    this.layers.annotation.setAlpha(255);
    this.layers.annotation.render();
    var data = this.layers.annotation.canvas.toDataURL();
    this.layers.annotation.setAlpha(0);
    this.layers.annotation.render();
    return data;
  };

  // Show a specified layer.
  Annotator.prototype.show = function (layer) {
    this.layers[layer].canvas.style.display = "inline-block";
    return this;
  };

  // Hide a specified layer.
  Annotator.prototype.hide = function (layer) {
    this.layers[layer].canvas.style.display = "none";
    return this;
  };

  // Highlight a specified label.
  Annotator.prototype.highlightLabel = function (label) {
    var pixels = [],
        annotationData = this.layers.annotation.imageData.data;
    for (var i = 0; i < annotationData.length; i += 4) {
      var currentLabel = _getEncodedLabel(annotationData, i);
      if (currentLabel === label)
        pixels.push(i);
    }
    this._updateHighlight(pixels);
    return this;
  };

  // Disable highlight.
  Annotator.prototype.unhighlightLabel = function () {
    this._updateHighlight(null);
    return this;
  };

  // Zoom to specific resolution.
  Annotator.prototype.zoom = function (scale) {
    this.currentZoom = Math.max(Math.min(scale || 1.0, 10.0), 1.0);
    this.innerContainer.style.zoom = this.currentZoom;
    this.innerContainer.style.MozTransform =
        "scale(" + this.currentZoom + ")";
    return this;
  };

  // Zoom in.
  Annotator.prototype.zoomIn = function (scale) {
    return this.zoom(this.currentZoom + (scale || 0.25));
  };

  // Zoom out.
  Annotator.prototype.zoomOut = function (scale) {
    return this.zoom(this.currentZoom - (scale || 0.25));
  };

  // // Align the current annotation to the boundary of superpixels.
  // Annotator.prototype.alignBoundary = function () {
  //   var annotationData = this.layers.annotation.imageData.data;
  //   for (var i = 0; i < this.pixelIndex.length; ++i) {
  //     var pixels = this.pixelIndex[i],
  //         label = _findMostFrequent(annotationData, pixels);
  //     this._fillPixels(pixels, label);
  //   }
  //   this.layers.visualization.render();
  //   this.history = [];
  //   this.currentHistoryRecord = 0;
  // };

  Annotator.prototype.denoise = function () {
    var indexImage = morph.decodeIndexImage(this.layers.annotation.imageData),
        result = morph.maxFilter(indexImage);
    var pixels = new Int32Array(result.data.length);
    for (var i = 0; i < pixels.length; ++i)
      pixels[i] = 4 * i;
    this._updateAnnotation(pixels, result.data);
    return this;
  };

  // Private methods.

  Annotator.prototype._createLayers = function (options) {
    var onload = options.onload;
    delete options.onload;
    this.container = document.createElement("div");
    this.container.classList.add("segment-annotator-outer-container");
    this.innerContainer = document.createElement("div");
    this.innerContainer.classList.add("segment-annotator-inner-container");
    this.layers = {
      image: new Layer(options),
      superpixel: new Layer(options),
      visualization: new Layer(options),
      boundary: new Layer(options),
      annotation: new Layer(options)
    };
    options.onload = onload;
    for (var key in this.layers) {
      var canvas = this.layers[key].canvas;
      canvas.classList.add("segment-annotator-layer");
      this.innerContainer.appendChild(canvas);
    }
    this.container.appendChild(this.innerContainer);
    this._resizeLayers(options);
  };

  Annotator.prototype._resizeLayers = function (options) {
    this.width = options.width || this.layers.image.canvas.width;
    this.height = options.height || this.layers.image.canvas.height;
    for (var key in this.layers) {
      if (key !== "image") {
        var canvas = this.layers[key].canvas;
        canvas.width = this.width;
        canvas.height = this.height;
      }
    }
    this.innerContainer.style.width = this.width;
    this.innerContainer.style.height = this.height;
    this.container.style.width = this.width;
    this.container.style.height = this.height;
  };

  Annotator.prototype._initializeHistory = function (options) {
    this.history = [];
    this.currentHistoryRecord = -1;
  };

  Annotator.prototype._initialize = function (options) {
    options = options || {};
    if (!options.width)
      this._resizeLayers(options);
    this._initializeAnnotationLayer();
    this._initializeVisualizationLayer();
    this._initializeEvents();
    this.resetSuperpixels(options.superpixelOptions);
    if (typeof options.onload === "function")
      options.onload.call(this);
    if (typeof this.onchange === "function")
      this.onchange.call(this);
  };

  Annotator.prototype._initializeEvents = function () {
    var canvas = this.layers.annotation.canvas,
        mousestate = { down: false, button: 0 },
        annotator = this;
    canvas.oncontextmenu = function() { return false; };
    function updateIfActive(event) {
      var offset = annotator._getClickOffset(event),
          superpixelData = annotator.layers.superpixel.imageData.data,
          superpixelIndex = _getEncodedLabel(superpixelData, offset),
          pixels = annotator.pixelIndex[superpixelIndex];
      annotator._updateHighlight(pixels);
      if (mousestate.down) {
        if (mousestate.button == 2 &&
            typeof annotator.onrightclick === "function") {
          var annotationData = annotator.layers.annotation.imageData.data;
          annotator.onrightclick.call(annotator,
                                      _getEncodedLabel(annotationData, offset));
        }
        else {
          annotator._updateAnnotation(pixels, annotator.currentLabel);
          if (typeof annotator.onleftclick === "function")
            annotator.onleftclick.call(annotator, annotator.currentLabel);
        }
      }
    }
    canvas.addEventListener('mousemove', updateIfActive);
    canvas.addEventListener('mouseup', updateIfActive);
    canvas.addEventListener('mouseleave', function (event) {
      annotator._updateHighlight(null);
    });
    canvas.addEventListener('mousedown', function (event) {
      mousestate.down = true;
      mousestate.button = event.button;
    });
    window.addEventListener('mouseup', function (event) {
      mousestate.down = false;
    });
  };

  Annotator.prototype._updateBoundaryLayer = function () {
    var boundaryLayer = this.layers.boundary;
    boundaryLayer.copy(this.layers.superpixel);
    boundaryLayer.computeEdgemap({
      foreground: [255, 255, 255, this.boundaryAlpha],
      background: [255, 255, 255, 0]
    });
    boundaryLayer.render();
  };

  Annotator.prototype._initializeAnnotationLayer = function () {
    var layer = this.layers.annotation;
    layer.resize(this.width, this.height);
    this.currentLabel = this.defaultLabel;
    layer.fill([this.defaultLabel, 0, 0, 0]);
    layer.render();
  };

  Annotator.prototype._initializeVisualizationLayer = function () {
    var layer = this.layers.visualization;
    layer.resize(this.width, this.height);
    var initialColor = this.colormap[this.defaultLabel]
                           .concat([this.visualizationAlpha]);
    layer.fill(initialColor);
    layer.render();
  };

  Annotator.prototype._updateSuperpixels = function () {
    var annotator = this;
    this.layers.superpixel.process(function (imageData) {
      imageData.data.set(annotator.segmentation.result.data);
      annotator._createPixelIndex(annotator.segmentation.result.numSegments);
      annotator._updateBoundaryLayer();
      this.setAlpha(0).render();
    });
  };

  Annotator.prototype._createPixelIndex = function (numSegments) {
    var pixelIndex = new Array(numSegments),
        data = this.layers.superpixel.imageData.data,
        i;
    for (i = 0; i < numSegments; ++i)
      pixelIndex[i] = [];
    for (i = 0; i < data.length; i += 4) {
      var index = data[i] | (data[i + 1] << 8) | (data[i + 2] << 16);
      pixelIndex[index].push(i);
    }
    this.currentPixels = null;
    this.pixelIndex = pixelIndex;
  };

  Annotator.prototype._getClickOffset = function (event) {
    var container = this.container,
        x = Math.round(
          (event.pageX - container.offsetLeft + container.scrollLeft) *
          (container.offsetWidth / container.scrollWidth)
          ),
        y = Math.round(
          (event.pageY - container.offsetTop + container.scrollTop) *
          (container.offsetHeight / container.scrollHeight)
          ),
        data = this.layers.superpixel.imageData.data,
        offset;
    var canvas = this.layers.image.canvas;
    x = Math.max(Math.min(x, this.layers.visualization.canvas.width - 1), 0);
    y = Math.max(Math.min(y, this.layers.visualization.canvas.height - 1), 0);
    offset = 4 * (y * this.layers.visualization.canvas.width + x);
    return offset;
  };

  Annotator.prototype._updateHighlight = function (pixels) {
    var visualizationData = this.layers.visualization.imageData.data,
        boundaryData = this.layers.boundary.imageData.data,
        i,
        offset;
    if (this.currentPixels !== null) {
      for (i = 0; i < this.currentPixels.length; ++i) {
        offset = this.currentPixels[i];
        visualizationData[offset + 3] = this.visualizationAlpha;
        if (boundaryData[offset + 3])
          boundaryData[offset + 3] = this.boundaryAlpha;
      }
    }
    this.currentPixels = pixels;
    if (this.currentPixels !== null) {
      for (i = 0; i < pixels.length; ++i) {
        offset = pixels[i];
        visualizationData[offset + 3] = this.highlightAlpha;
        if (boundaryData[offset + 3])
          boundaryData[offset + 3] = this.highlightAlpha;
      }
    }
    this.layers.visualization.render();
    this.layers.boundary.render();
  };

  Annotator.prototype._fillPixels = function (pixels, labels) {
    if (pixels.length !== labels.length)
      throw "Invalid fill: " + pixels.length + " !== " + labels.length;
    var annotationData = this.layers.annotation.imageData.data,
        visualizationData = this.layers.visualization.imageData.data;
    for (i = 0; i < pixels.length; ++i) {
      var offset = pixels[i],
          label = labels[i],
          color = this.colormap[label];
      _setEncodedLabel(annotationData, offset, label);
      visualizationData[offset + 0] = color[0];
      visualizationData[offset + 1] = color[1];
      visualizationData[offset + 2] = color[2];
    }
  };

  // Update label.
  Annotator.prototype._updateAnnotation = function (pixels, labels) {
    var updates;
    labels = (typeof labels === "object") ?
        labels : _fillArray(new Int32Array(pixels.length), labels);
    updates = this._getDifferentialUpdates(pixels, labels);
    if (updates.pixels.length === 0)
      return this;
    this._updateHistory(updates);
    this._fillPixels(updates.pixels, updates.next);
    this.layers.visualization.render();
    if (typeof this.onchange === "function")
      this.onchange.call(this);
    return this;
  };

  // Get the differential update of labels.
  Annotator.prototype._getDifferentialUpdates = function (pixels, labels) {
    if (pixels.length !== labels.length)
      throw "Invalid labels";
    var annotationData = this.layers.annotation.imageData.data,
        updates = { pixels: [], prev: [], next: [] };
    for (var i = 0; i < pixels.length; ++i) {
      var label = _getEncodedLabel(annotationData, pixels[i]);
      if (label !== labels[i]) {
        updates.pixels.push(pixels[i]);
        updates.prev.push(label);
        updates.next.push(labels[i]);
      }
    }
    return updates;
  };

  Annotator.prototype._updateHistory = function (updates) {
    this.history = this.history.slice(0, this.currentHistoryRecord + 1);
    this.history.push(updates);
    if (this.history.length > this.maxHistoryRecord)
      this.history = this.history.slice(1, this.history.length);
    else
      ++this.currentHistoryRecord;
  };

  function _fillArray(array, value) {
    for (var i = 0; i < array.length; ++i)
      array[i] = value;
    return array;
  }

  function _findMostFrequent(annotationData, pixels) {
    var histogram = {},
        j;
    for (j = 0; j < pixels.length; ++j) {
      var label = _getEncodedLabel(annotationData, pixels[j]);
      histogram[label] = (histogram[label]) ? histogram[label] + 1 : 1;
    }
    var maxFrequency = 0,
        majorLabel = 0;
    for (j in histogram) {
      var frequency = histogram[j];
      if (frequency > maxFrequency) {
        maxFrequency = frequency;
        majorLabel = j;
      }
    }
    return majorLabel;
  }

  function _getEncodedLabel(array, offset) {
    return array[offset] |
           (array[offset + 1] << 8) |
           (array[offset + 2] << 16);
  }

  function _setEncodedLabel(array, offset, label) {
    array[offset + 0] = label & 255;
    array[offset + 1] = (label >>> 8) & 255;
    array[offset + 2] = (label >>> 16) & 255;
    array[offset + 3] = 255;
  }

  return Annotator;
});