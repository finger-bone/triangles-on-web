const grid_length = 256;
const workgroup_size = 16;

const requestDevice = async (): Promise<[GPUAdapter, GPUDevice] | null> => {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
        console.error('WebGPU not supported');
        return null;
    }
    const device = await adapter.requestDevice();
    console.log(device);
    return [adapter, device];
}

const getContext = async (device: GPUDevice): Promise<[GPUCanvasContext, GPUTextureFormat]> => {
    const canvas = document.getElementById('app') as HTMLCanvasElement;
    const context = canvas.getContext("webgpu")!;
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
        device: device,
        format: canvasFormat,
    });
    return [context, canvasFormat];
}

const getShaderModule = async (device: GPUDevice): Promise<GPUShaderModule> => {
    return device.createShaderModule({
        label: "shader",
        code: `
            @group(0) @binding(0) var<storage> states: array<u32>;

            struct VertexOutput {
                @builtin(position) pos: vec4f,
                @location(0) cell: u32,
            };

            @vertex
            fn vertexMain(@location(0) pos: vec2f, @builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
                var output: VertexOutput;
                output.pos = vec4<f32>(pos, 0.0, 1.0);
                output.cell = vertexIndex / 6;
                return output;
            }
            @fragment
            fn fragmentMain(input: VertexOutput) -> vec4<f32> {
                if(states[input.cell] == 0u) {
                    discard;
                }
                return vec4<f32>(1.0, 1.0, 0.0, 1.0);
            }
        `
    });
}

const getVertexBuffer = async (device: GPUDevice): Promise<[GPUBuffer, GPUVertexBufferLayout]> => {
    const vertexBuffer = device.createBuffer({
        size: grid_length * grid_length * 4 * 12,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
    });
    const vertices = new Float32Array(grid_length * grid_length * 12);
    // starts from -1 to 1
    const step = 2 / grid_length;
    const padding = step / 6;
    for(let i = 0; i < grid_length; i++) {
        for(let j = 0; j < grid_length; j++) {
            const top_left_x = -1 + i * step;
            const top_left_y = 1 - j * step;
            const bottom_right_x = top_left_x + step;
            const bottom_right_y = top_left_y - step;
            const index = (i * grid_length + j) * 12;
            
            vertices[index] = top_left_x + padding;
            vertices[index + 1] = top_left_y - padding;

            vertices[index + 2] = bottom_right_x - padding;
            vertices[index + 3] = top_left_y - padding;

            vertices[index + 4] = top_left_x + padding;
            vertices[index + 5] = bottom_right_y + padding;

            vertices[index + 6] = top_left_x + padding;
            vertices[index + 7] = bottom_right_y + padding;

            vertices[index + 8] = bottom_right_x - padding;
            vertices[index + 9] = top_left_y - padding;

            vertices[index + 10] = bottom_right_x - padding;
            vertices[index + 11] = bottom_right_y + padding;
        }
    }
    new Float32Array(vertexBuffer.getMappedRange()).set(vertices);
    const vertexBufferLayout: GPUVertexBufferLayout = {
        arrayStride: 8,
        attributes: [{
            format: "float32x2",
            offset: 0,
            shaderLocation: 0,
        }],
    };
    vertexBuffer.unmap();
    return [vertexBuffer, vertexBufferLayout];
}

const getComputationShaderModule = async (device: GPUDevice): Promise<GPUShaderModule> => {
    return device.createShaderModule({
        label: "computation shader",
        code: `
            @group(0) @binding(0) var<storage> states: array<u32>;
            @group(0) @binding(1) var<storage, read_write> next_states: array<u32>;

            @compute
            @workgroup_size(${workgroup_size}, ${workgroup_size})
            fn computeMain(@builtin(global_invocation_id) cell: vec3u) {
                let index = cell.x * ${grid_length} + cell.y;
                var count = 0u;
                for(var i: i32 = -1; i < 2; i++) {
                    for(var j: i32 = -1; j < 2; j++) {
                        if(i == 0 && j == 0) {
                            continue;
                        }
                        let x = i32(cell.x) + i;
                        let y = i32(cell.y) + j;
                        if(x >= 0 && x < ${grid_length} && y >= 0 && y < ${grid_length}) {
                            count += states[x * ${grid_length} + y];
                        }
                    }
                }
                if(states[index] == 1u) {
                    if(count < 2u || count > 3u) {
                        next_states[index] = 0u;
                    } else {
                        next_states[index] = 1u;
                    }
                } else {
                    if(count == 3u) {
                        next_states[index] = 1u;
                    } else {
                        next_states[index] = 0u;
                    }
                }
            }
        `
    });
}
    

const main = async () => {
    const [_, device] = (await requestDevice())!;
    const [context, canvasFormat] = await getContext(device);
    const shaderModule = await getShaderModule(device);
    const [vertexBuffer, vertexBufferLayout] = await getVertexBuffer(device);
    const states = new Uint32Array(grid_length * grid_length);
    for(let i = 0; i < grid_length * grid_length; i++) {
        states[i] = Math.random() > 0.5 ? 0 : 1;
    }
    const statesStorageBuffer = [
        device.createBuffer({
            size: grid_length * grid_length * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        }),
        device.createBuffer({
            size: grid_length * grid_length * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        })
    ]
    device.queue.writeBuffer(statesStorageBuffer[0], 0, states.buffer);
    const bindGroupLayout = device.createBindGroupLayout({
        entries: [{
            binding: 0,
            visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE | GPUShaderStage.VERTEX,
            buffer: {
                type: "read-only-storage"
            }
        }, {
            binding: 1,
            visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
            buffer: {
                type: "storage"
            }
        }]
    });
    const pipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout]
    });
    const pipeline = device.createRenderPipeline({
        label: "pipeline",
        layout: pipelineLayout,
        vertex: {
            module: shaderModule,
            entryPoint: "vertexMain",
            buffers: [vertexBufferLayout]
        },
        fragment: {
            module: shaderModule,
            entryPoint: "fragmentMain",
            targets: [{
                format: canvasFormat
            }]
        }
    });
    const computeShaderModule = await getComputationShaderModule(device);
    const computePipeline = device.createComputePipeline({
        layout: pipelineLayout,
        compute: {
            module: computeShaderModule,
            entryPoint: "computeMain"
        }
    });
    const render = async (step: number) => {
        const encoder = device.createCommandEncoder();
        const bindGroup = device.createBindGroup({
            label: "bind group",
            layout: bindGroupLayout,
            entries: [{
                binding: 0,
                resource: { buffer: statesStorageBuffer[step % 2] },
            }, {
                binding: 1,
                resource: { buffer: statesStorageBuffer[(step + 1) % 2] },
            }]
        });
        
        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: context.getCurrentTexture().createView(),
                loadOp: "clear",
                clearValue: { r: 0.1, g: 0.3, b: 0.6, a: 1.0 },
                storeOp: "store",
            }]
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.setVertexBuffer(0, vertexBuffer);
        pass.draw(grid_length * grid_length * 6);
        pass.end();

        const computePass = encoder.beginComputePass();
        computePass.setPipeline(computePipeline);
        computePass.setBindGroup(0, bindGroup);
        const factor = Math.floor(grid_length / workgroup_size);
        computePass.dispatchWorkgroups(factor, factor)
        computePass.end();

        const commandBuffer = encoder.finish();
        device.queue.submit([commandBuffer]);
    }
    let step = 0;
    setInterval(() => {
        render(step);
        step++;
        step = step % 2;
    }, 100);
}

main()