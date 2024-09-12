const main = async () => {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
        console.error('WebGPU not supported');
        return;
    }
    const device = await adapter.requestDevice();
    console.log(device);
    const canvas = document.getElementById('app') as HTMLCanvasElement;
    const context = canvas.getContext("webgpu")!;
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
        device: device,
        format: canvasFormat,
    });
    const vertices = [
        0.0, 0.0,
        0.0, 1.0,
        1.0, 0.0,

        1.0, 1.0,
        0.0, 1.0,
        1.0, 0.0,
    ]
    const vertexBuffer = device.createBuffer({
        size: vertices.length * 4,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
    });
    new Float32Array(vertexBuffer.getMappedRange()).set(vertices);
    const vertexBufferLayout: GPUVertexBufferLayout = {
        arrayStride: 8,
        attributes: [{
            format: "float32x2",
            offset: 0,
            shaderLocation: 0,
        }],
    };
    const shaderModule = device.createShaderModule({
        label: "shader",
        code: `
            @vertex
            fn vertexMain(@location(0) pos: vec2f) -> @builtin(position) vec4f {
                return vec4f(pos, 0, 1);
            }
            @fragment
            fn fragmentMain() -> vec4<f32> {
                return vec4<f32>(1.0, 1.0, 0.0, 1.0);
            }
        `
    });
    vertexBuffer.unmap();
    const pipeline = device.createRenderPipeline({
        label: "Cell pipeline",
        layout: "auto",
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
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
        colorAttachments: [{
            view: context.getCurrentTexture().createView(),
            loadOp: "clear",
            clearValue: { r: 0.1, g: 0.3, b: 0.8, a: 1.0 },
            storeOp: "store",
        }]
    });
    pass.setPipeline(pipeline);
    pass.setVertexBuffer(0, vertexBuffer);
    pass.draw(vertices.length / 2);
    pass.end();
    const commandBuffer = encoder.finish();
    device.queue.submit([commandBuffer]);
}

main()