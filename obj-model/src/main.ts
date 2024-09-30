import ObjFileParser from "obj-file-parser";

const f = 1.5;

const get_device = async (): Promise<[GPUAdapter, GPUDevice]> => {
    const adapter = await navigator.gpu.requestAdapter();
    if(!adapter) {
        throw new Error("WebGPU not supported");
    }
    const device = await adapter.requestDevice();
    return [adapter, device];
}

const get_context = async (device: GPUDevice): Promise<[GPUCanvasContext, GPUTextureFormat]> => {
    const canvas = document.getElementById("app")! as HTMLCanvasElement;
    const ctx = canvas.getContext("webgpu")!;
    const format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({
        format: format,
        device: device,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
    })
    return [ctx, format];
}

const get_shader = async (device: GPUDevice): Promise<GPUShaderModule> => {
    return device.createShaderModule({
        label: "sm",
        code: `
        @group(0) @binding(0) var<uniform> projection: mat4x4<f32>;
        @group(0) @binding(1) var<uniform> angle: f32;
        @group(1) @binding(0) var texture: texture_2d<f32>;
        @group(1) @binding(1) var tx_sampler: sampler;

        struct VertexOutput {
            @builtin(position) pos: vec4f,
            @location(0) @interpolate(flat) face: u32,
            @location(1) @interpolate(linear) real_position: vec3f,
            @location(2) @interpolate(linear) normal: vec3f,
            @location(3) @interpolate(linear) tex_coords: vec2f,
        };

        @vertex
        fn vertexMain(@location(0) position: vec3f, @location(1) norm: vec3f, @location(2) tex: vec3f, @builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
            let rotation = mat3x3<f32>(
                vec3<f32>(cos(angle), 0.0, sin(angle)),
                vec3<f32>(0.0, 1.0, 0.0),
                vec3<f32>(-sin(angle), 0.0, cos(angle)),
            );
            let rotated = vec4<f32>(rotation * 0.1 * (position - vec3f(0.0, 0.0, 0.5)), 1.0);
            var projected = projection * (rotated - vec4<f32>(0.0, 0.0, ${f}, 0.0));
            let final_position = vec4<f32>(projected.xy, 1.0 - rotated.z, projected.w);

            var output = VertexOutput(final_position, vertexIndex / 6, rotated.xyz, rotation * norm, tex.xy);
            return output;
        }

        @fragment
        fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {

            let light_source = vec3<f32>(-5.0, -2.0, -9.0);
            let l = normalize(light_source - input.real_position);
            let n = normalize(input.normal);
            let r = reflect(-l, n);
            let camera = vec3<f32>(0.0, 0.0, -1.0);
            let v = normalize(camera - input.real_position);
            let spec = pow(max(dot(r, v), 0.0), 4.0) * 0.5;
            let diff = max(dot(-n, l), 0.0) * 0.5;
            let amb = 0.1;
            let albedo = textureSample(texture, tx_sampler, input.tex_coords).xyz;
            let color = albedo * min(amb + diff + spec, 1.0);
            return vec4<f32>(color, 1.0);
        }
        `,
    })
}

const get_vertices = (device: GPUDevice, model: ObjFileParser.ObjModel): [GPUBuffer, GPUVertexBufferLayout] => {
    const verticesWithNormals = new Float32Array(model.faces.length * 2 * 3 * 3 * 3);
    let groupOffset = model.faces.length * 3 * 3 * 3;
    for (let i = 0; i < model.faces.length; i++) {
        const face = model.faces[i];
        const firstGroup = [
            face.vertices[0],
            face.vertices[1],
            face.vertices[2]
        ]

        const secondGroup = [
            face.vertices[0],
            face.vertices[2],
            face.vertices[3],
        ]

        for (let j = 0; j < 3; j++) {
            const vertex = model.vertices[firstGroup[j].vertexIndex - 1];
            const normal = model.vertexNormals[firstGroup[j].vertexNormalIndex - 1];
            const tex = model.textureCoords[firstGroup[j].textureCoordsIndex - 1];
            verticesWithNormals.set([vertex.x, -vertex.z, vertex.y], (i * 3 + j) * 9);
            verticesWithNormals.set([normal.x, -normal.z, normal.y], (i * 3 + j) * 9 + 3);
            verticesWithNormals.set([tex.u, tex.v, tex.w], (i * 3 + j) * 9 + 6);
        }

        for (let j = 0; j < 3; j++) {
            const vertex = model.vertices[secondGroup[j].vertexIndex - 1];
            const normal = model.vertexNormals[secondGroup[j].vertexNormalIndex - 1];
            const tex = model.textureCoords[secondGroup[j].textureCoordsIndex - 1];
            verticesWithNormals.set([vertex.x, -vertex.z, vertex.y], groupOffset + (i * 3 + j) * 9);
            verticesWithNormals.set([normal.x, -normal.z, normal.y], groupOffset + (i * 3 + j) * 9 + 3);
            verticesWithNormals.set([tex.u, tex.v, tex.w], groupOffset + (i * 3 + j) * 9 + 6);
        }
    }

    const layout: GPUVertexBufferLayout = {
        arrayStride: 3 * 4 * 3,
        attributes: [{
            format: "float32x3",
            offset: 0,
            shaderLocation: 0,
        }, {
            format: "float32x3",
            offset: 3 * 4,
            shaderLocation: 1
        }, {
            format: "float32x3",
            offset: 3 * 4 * 2,
            shaderLocation: 2,
        }]
    }
    const buffer = device.createBuffer({
        size: verticesWithNormals.length * 4,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    })
    device.queue.writeBuffer(buffer, 0, verticesWithNormals.buffer);
    return [buffer, layout];
}

const get_depth_texture = (device: GPUDevice, size: { width: number, height: number }): GPUTexture => {
    return device.createTexture({
        size: {
            width: size.width,
            height: size.height,
            depthOrArrayLayers: 1,
        },
        format: "depth24plus",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
    });
}

const get_texture = async (device: GPUDevice, url: string): Promise<GPUTexture> => {
    const img = await fetch(url).then((res) => res.blob()).then((blob) => createImageBitmap(blob));
    const bitmap = await createImageBitmap(img);
    const texture = device.createTexture({
        size: [bitmap.width, bitmap.height, 1],
        format: "rgba8unorm",
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture({ source: bitmap, flipY: true }, { texture }, [bitmap.width, bitmap.height, 1]);
    return texture;
}

const get_sampler = (device: GPUDevice): GPUSampler => {
    return device.createSampler({
        magFilter: "linear",
        minFilter: "linear",
    })
}

const get_texture_bind_group = (device: GPUDevice, texture: GPUTexture, sampler: GPUSampler): [GPUBindGroup, GPUBindGroupLayout] => {
    const layout = device.createBindGroupLayout({
        entries: [{
            binding: 0,
            visibility: GPUShaderStage.FRAGMENT,
            texture: {
                sampleType: "float",
            }
        }, {
            binding: 1,
            visibility: GPUShaderStage.FRAGMENT,
            sampler: {}
        }]
    });
    const bindGroup = device.createBindGroup({
        layout: layout,
        entries: [{
            binding: 0,
            resource: texture.createView()
        }, {
            binding: 1,
            resource: sampler,
        }]
    });
    return [bindGroup, layout];
}

const main = async () => {
    const [_, device] = await get_device();
    const [ctx, format] = await get_context(device);
    const shader = await get_shader(device);
    const objFile = await fetch("bird/12213_Bird_v1_l3.obj").then((res) => res.text());
    const objRes = new ObjFileParser(objFile).parse();
    const model = objRes.models[0];
    const texture = await get_texture(device, `bird/12213_bird_diffuse.jpg`);
    const sampler = get_sampler(device);
    const [textureBindGroup, textureBindGroupLayout] = get_texture_bind_group(device, texture, sampler);

    const [vertices, vertexBufferLayout] = get_vertices(device, model);

    const projectionMatrix = new Float32Array([
        -f, 0, 0, 0,
        0, -f, 0, 0,
        0, 0, 0, -f,
        0, 0, 1, 0,
    ]);
    const projectionBuffer = device.createBuffer({
        size: 4 * 4 * 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(
        projectionBuffer,
        0,
        projectionMatrix.buffer,
    )
    const render = () => {
        const depthTexture = get_depth_texture(device, { width: ctx.canvas.width, height: ctx.canvas.height });

        const encoder = device.createCommandEncoder();

        const renderPassDescriptor: GPURenderPassDescriptor = {
            colorAttachments: [{
                view: ctx.getCurrentTexture().createView(),
                clearValue: { r: 0.1, g: 0.1, b: 0.1, a: 1.0 },
                storeOp: "store",
                loadOp: "clear",
            }],
            depthStencilAttachment: {
                view: depthTexture.createView(),
                depthClearValue: 1.0,
                depthStoreOp: "store",
                depthLoadOp: "clear",
            }
        }
        const pass = encoder.beginRenderPass(renderPassDescriptor);
        const angle = document.getElementById("angle") as HTMLInputElement;
        const angleBuffer = new Float32Array([parseFloat(angle.value) * (Math.PI / 180)]);
        const angleBufferGPU = device.createBuffer({
            size: 4,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(
            angleBufferGPU,
            0,
            angleBuffer.buffer,
        );
        const bindGroupLayout = device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: {   
                        type: "uniform"
                    }
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: {
                        type: "uniform"
                    }
                }
            ]
        });
        const bindGroup = device.createBindGroup({
            layout: bindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: projectionBuffer,
                    }
                }, {
                    binding: 1,
                    resource: {
                        buffer: angleBufferGPU,
                    }
                }
            ]
        });
        
        const pipelineLayout = device.createPipelineLayout({
            bindGroupLayouts: [bindGroupLayout, textureBindGroupLayout]
        });
        const pipeline = device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: {
                module: shader,
                entryPoint: "vertexMain",
                buffers: [vertexBufferLayout],
            },
            fragment: {
                module: shader,
                entryPoint: "fragmentMain",
                targets: [{
                    format: format,
                }]
            },
            depthStencil: {
                format: "depth24plus",
                depthWriteEnabled: true,
                depthCompare: "less-equal",
            }
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.setBindGroup(1, textureBindGroup);
        pass.setVertexBuffer(0, vertices);
        pass.draw(model.faces.length * 3 * 2);
        pass.end();
        const command = encoder.finish();
        device.queue.submit([command]);
    }
    setInterval(render, 10);
}

main();
