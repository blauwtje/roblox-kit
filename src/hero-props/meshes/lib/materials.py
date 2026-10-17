"""Shader-node helpers and the paint stack: every Blender material a mesh script builds starts here."""

from typing import NamedTuple

import bpy


class Surface(NamedTuple):
    material: object
    paint: float = 0.0


def linear(hex_color):
    def channel(value):
        value /= 255
        return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4

    return tuple(channel(int(hex_color[i : i + 2], 16)) for i in (1, 3, 5)) + (1.0,)


def ramp_node(nodes, stops):
    """A color ramp from (position, hex) stops."""
    ramp = nodes.new("ShaderNodeValToRGB")
    elements = ramp.color_ramp.elements
    while len(elements) < len(stops):
        elements.new(0.5)
    for element, (position, hex_color) in zip(elements, stops):
        element.position = position
        element.color = linear(hex_color)
    return ramp


def mix_color(tree, blend, inputs):
    """A color mix of (factor, a, b); a float factor and tuple colors are set, sockets are linked."""
    nodes, links = tree.nodes, tree.links
    factor, a, b = inputs
    mix = nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = blend
    if isinstance(factor, float):
        mix.inputs["Factor"].default_value = factor
    else:
        links.new(factor, mix.inputs["Factor"])
    for socket, value in (("A", a), ("B", b)):
        if isinstance(value, tuple):
            mix.inputs[socket].default_value = value
        else:
            links.new(value, mix.inputs[socket])
    return mix.outputs["Result"]


def mix_float(tree, inputs):
    """A float mix of (factor, a, b); floats are set, sockets are linked."""
    nodes, links = tree.nodes, tree.links
    factor, a, b = inputs
    mix = nodes.new("ShaderNodeMix")
    mix.data_type = "FLOAT"
    for socket, value in (("Factor", factor), ("A", a), ("B", b)):
        if isinstance(value, float):
            mix.inputs[socket].default_value = value
        else:
            links.new(value, mix.inputs[socket])
    return mix.outputs["Result"]


def math_node(tree, operation, inputs):
    """A math node of the operation over (a, b) or (a, b, c); floats are set, sockets are linked."""
    nodes, links = tree.nodes, tree.links
    node = nodes.new("ShaderNodeMath")
    node.operation = operation
    for index, value in enumerate(inputs):
        if isinstance(value, float):
            node.inputs[index].default_value = value
        else:
            links.new(value, node.inputs[index])
    return node.outputs["Value"]


def noise(tree, vector, settings):
    """A noise texture over the vector socket, with (scale, detail)."""
    nodes, links = tree.nodes, tree.links
    scale, detail = settings
    texture = nodes.new("ShaderNodeTexNoise")
    texture.inputs["Scale"].default_value = scale
    texture.inputs["Detail"].default_value = detail
    links.new(vector, texture.inputs["Vector"])
    return texture.outputs["Fac"]


def flat_material(name, hex_color, roughness):
    material = bpy.data.materials.new(name)
    bsdf = material.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = linear(hex_color)
    bsdf.inputs["Roughness"].default_value = roughness
    return material


def link_object(name, data, material):
    obj = bpy.data.objects.new(name, data)
    obj.data.materials.append(material)
    bpy.context.collection.objects.link(obj)
    return obj


def mark_paint(obj, value):
    paint = obj.data.attributes.new("paint", "FLOAT", "POINT")
    paint.data.foreach_set("value", [value] * len(obj.data.vertices))


def paint_stack(paints, wear=0.02):
    """The base of a painted material: noisy paint colors switched by the "paint" vertex attribute, then edge wear.

    The paint value comes from the attribute each part carries, since joining loses objects. Edge wear is where a
    bevelled normal leaves the true normal (not Pointiness, which is per vertex), broken up by noise; under the body
    it shows dark iron, under the trim a lighter bare metal.

    `paints` is [(ramp stops, bare hex), ...] for paint values 0 and 1 (body, trim); `wear` is the bevel radius,
    in studs, of the edge wear. Returns the material and its parts: `coords` (object position), `geometry`,
    `bsdf`, `dark_amount` (the paint value), `patch` (the paint noise), `wear` (edge-wear amount) and `worn`
    (the color so far), for the script to layer its own dirt on.
    """
    (body_stops, body_bare), (trim_stops, trim_bare) = paints
    material = bpy.data.materials.new("paint")
    tree = material.node_tree
    nodes, links = tree.nodes, tree.links
    coords = nodes.new("ShaderNodeTexCoord").outputs["Object"]
    geometry = nodes.new("ShaderNodeNewGeometry")
    paint_attribute = nodes.new("ShaderNodeAttribute")
    paint_attribute.attribute_name = "paint"
    dark_amount = paint_attribute.outputs["Fac"]
    patch = noise(tree, coords, (2.5, 6.0))
    body = ramp_node(nodes, body_stops)
    links.new(patch, body.inputs["Fac"])
    trim = ramp_node(nodes, trim_stops)
    links.new(patch, trim.inputs["Fac"])
    painted = mix_color(tree, "MIX", (dark_amount, body.outputs["Color"], trim.outputs["Color"]))
    bevel = nodes.new("ShaderNodeBevel")
    bevel.inputs["Radius"].default_value = wear
    facing = nodes.new("ShaderNodeVectorMath")
    facing.operation = "DOT_PRODUCT"
    links.new(bevel.outputs["Normal"], facing.inputs[0])
    links.new(geometry.outputs["Normal"], facing.inputs[1])
    edge_ramp = ramp_node(nodes, [(0.9, "#ffffff"), (0.97, "#000000")])
    links.new(facing.outputs["Value"], edge_ramp.inputs["Fac"])
    chip_ramp = ramp_node(nodes, [(0.45, "#000000"), (0.58, "#ffffff")])
    links.new(noise(tree, coords, (12.0, 6.0)), chip_ramp.inputs["Fac"])
    worn_amount = math_node(tree, "MULTIPLY", (edge_ramp.outputs["Color"], chip_ramp.outputs["Color"]))
    bare = mix_color(tree, "MIX", (dark_amount, linear(body_bare), linear(trim_bare)))
    worn = mix_color(tree, "MIX", (worn_amount, painted, bare))
    return material, {
        "coords": coords,
        "geometry": geometry,
        "bsdf": nodes["Principled BSDF"],
        "dark_amount": dark_amount,
        "patch": patch,
        "wear": worn_amount,
        "worn": worn,
    }
