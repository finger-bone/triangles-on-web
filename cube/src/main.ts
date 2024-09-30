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
    })
    return [ctx, format];
}

const get_shader = async (device: GPUDevice): Promise<GPUShaderModule> => {
    return device.createShaderModule({
        label: "sm",
        code: `
        @group(0) @binding(0) var<uniform> projection: mat4x4<f32>;
        @group(0) @binding(1) var<uniform> angle: f32;

        struct VertexOutput {
            @builtin(position) pos: vec4f,
            @location(0) @interpolate(flat) face: u32,
        };

        @vertex
        fn vertexMain(@location(0) position: vec3f, @builtin(vertex_index) vertexIndex: u32) -> VertexOutput {

            let rotation = mat3x3<f32>(
                vec3<f32>(1.0, 0.0, 0.0),
                vec3<f32>(0.0, cos(angle), sin(angle)),
                vec3<f32>(0.0, -sin(angle), cos(angle)),
            );

            let rotated = vec4<f32>(rotation * (position - vec3f(0.4, 0.4, 0.0)), 1.0);
            var projected = projection * (rotated - vec4<f32>(0.0, 0.0, ${f}, 0.0));
            let final_position = vec4<f32>(projected.xy, 1.0 - rotated.z, projected.w);

            var output = VertexOutput(final_position, vertexIndex / 6);
            return output;
        }

        struct FragmentOutput {
            @location(0) color: vec4<f32>,
        };

        @fragment
        fn fragmentMain(input: VertexOutput) -> FragmentOutput {
            var output = FragmentOutput(vec4<f32>(1.0, 1.0, 1.0, 1.0));
            if (input.face == 0u) {
                output.color = vec4<f32>(1.0, 0.0, 0.0, 1.0);
            } else if (input.face == 1u) {
                output.color = vec4<f32>(0.0, 1.0, 0.0, 1.0);
            } else if (input.face == 2u) {
                output.color = vec4<f32>(0.0, 0.0, 1.0, 1.0);
            } else if (input.face == 3u) {
                output.color = vec4<f32>(1.0, 1.0, 0.0, 1.0);
            } else if (input.face == 4u) {
                output.color = vec4<f32>(1.0, 0.0, 1.0, 1.0);
            } else {
                output.color = vec4<f32>(0.0, 1.0, 1.0, 1.0);
            }
            return output;
        }
        `,
    })
}

const get_vertices = (device: GPUDevice): [GPUBuffer, GPUVertexBufferLayout] => {
    // cube
    // use triangle
    const vertices = new Float32Array([
        // xy
        1.0, 0.0, 0.0,
        0.0, 1.0, 0.0,
        0.0, 0.0, 0.0,

        1.0, 0.0, 0.0,
        0.0, 1.0, 0.0,
        1.0, 1.0, 0.0,

        1.0, 0.0, 1.0,
        0.0, 1.0, 1.0,
        0.0, 0.0, 1.0,

        1.0, 0.0, 1.0,
        0.0, 1.0, 1.0,
        1.0, 1.0, 1.0,
        // yz
        0.0, 1.0, 0.0,
        0.0, 0.0, 1.0,
        0.0, 0.0, 0.0,

        0.0, 1.0, 0.0,
        0.0, 0.0, 1.0,
        0.0, 1.0, 1.0,

        1.0, 1.0, 0.0,
        1.0, 0.0, 1.0,
        1.0, 0.0, 0.0,
        
        1.0, 1.0, 0.0,
        1.0, 0.0, 1.0,
        1.0, 1.0, 1.0,
        // zx
        0.0, 0.0, 1.0,
        1.0, 0.0, 0.0,
        1.0, 0.0, 1.0,

        0.0, 0.0, 1.0,
        1.0, 0.0, 0.0,
        0.0, 0.0, 0.0,

        0.0, 1.0, 1.0,
        1.0, 1.0, 0.0,
        1.0, 1.0, 1.0,

        0.0, 1.0, 1.0,
        1.0, 1.0, 0.0,
        0.0, 1.0, 0.0,
    ]).map((v) => v * 0.5 - 0.25);
    const layout: GPUVertexBufferLayout = {
        arrayStride: 3 * 4,
        attributes: [{
            format: "float32x3",
            offset: 0,
            shaderLocation: 0,
        }]
    }
    const buffer = device.createBuffer({
        size: vertices.length * 4,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    })
    device.queue.writeBuffer(buffer, 0, vertices.buffer);
    return [buffer, layout];
}

const get_depth_texture = (device: GPUDevice, size: { width: number, height: number }): GPUTexture => {
    return device.createTexture({
        size: {
            width: size.width,
            height: size.height,
            depthOrArrayLayers: 1
        },
        format: "depth24plus",
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
}

const main = async () => {
    const [_, device] = await get_device();
    const [ctx, format] = await get_context(device);
    const shader = await get_shader(device);
    const [vertices, vertexBufferLayout] = get_vertices(device);

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
            bindGroupLayouts: [bindGroupLayout]
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
        pass.setVertexBuffer(0, vertices);
        pass.draw(6 * 2 * 3);
        pass.end();
        const command = encoder.finish();
        device.queue.submit([command]);
    }
    setInterval(render, 10);
}

main();
