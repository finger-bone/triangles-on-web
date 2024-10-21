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
            fn factorial(n: i32) -> i32 {
                var result: i32 = 1;
                for (var i: i32 = 1; i <= n; i = i + 1) {
                    result = result * i;
                }
                return result;
            }

            fn comb(n: i32, k: i32) -> i32 {
                return factorial(n) / (factorial(k) * factorial(n - k));
            }

            @vertex
            fn vertexMain(@location(0) t: f32) -> @builtin(position) vec4<f32> {
                // calculate all the bezier functions
                var b40 = f32(comb(4, 0)) * pow(1.0 - t, 4 - 0) * pow(t, 0);
                var b41 = f32(comb(4, 1)) * pow(1.0 - t, 4 - 1) * pow(t, 1);
                var b42 = f32(comb(4, 2)) * pow(1.0 - t, 4 - 2) * pow(t, 2);
                var b43 = f32(comb(4, 3)) * pow(1.0 - t, 4 - 3) * pow(t, 3);
                var b44 = f32(comb(4, 4)) * pow(1.0 - t, 4 - 4) * pow(t, 4);
                var p0 = vec2<f32>(-0.8, -0.8);
                var p1 = vec2<f32>(-1, 1);
                var p2 = vec2<f32>(1, 1);
                var p3 = vec2<f32>(1, -1);
                var p4 = vec2<f32>(-0.8, -0.8);
                var res = vec2<f32>(0.0, 0.0);
                res = res + b40 * p0;
                res = res + b41 * p1;
                res = res + b42 * p2;
                res = res + b43 * p3;
                res = res + b44 * p4;
                return vec4<f32>(res, 0.0, 1.0);
            }

            @fragment
            fn fragmentMain() -> @location(0) vec4<f32> {
                return vec4<f32>(1.0, 1.0, 1.0, 1.0);
            }
        `
    });
}
const totalPoints = 100;
const getVertexBuffer = async (device: GPUDevice): Promise<[GPUBuffer, GPUVertexBufferLayout]> => {
    const t = new Float32Array(
        Array.from(
            new Array(totalPoints),
            (_, i) => i
        ).flatMap((i) => [i / totalPoints, (i + 1) / totalPoints])
    );
    const tBufferLayout: GPUVertexBufferLayout = {
        attributes: [
            {
                shaderLocation: 0,
                offset: 0,
                format: "float32"
            }
        ],
        arrayStride: 4,
        stepMode: "vertex"
    };
    const tBuffer = device.createBuffer({
        size: t.byteLength,
        usage: GPUBufferUsage.VERTEX,
        mappedAtCreation: true
    });
    new Float32Array(tBuffer.getMappedRange()).set(t);
    tBuffer.unmap();
    return [tBuffer, tBufferLayout];
}

const main = async () => {
    const [_, device] = (await requestDevice())!;
    const [context, format] = await getContext(device);
    const shaderModule = await getShaderModule(device);

    const [tBuffer, tBufferLayout] = await getVertexBuffer(device);
    const encoder = device.createCommandEncoder();
    const renderPassDescriptor: GPURenderPassDescriptor = {
        colorAttachments: [{
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0.1, g: 0.1, b: 0.1, a: 1.0 },
            storeOp: "store",
            loadOp: "clear",
        }],
    }
    const passEncoder = encoder.beginRenderPass(renderPassDescriptor);
    const pipeline = device.createRenderPipeline({
        vertex: {
            module: shaderModule,
            entryPoint: "vertexMain",
            buffers: [tBufferLayout]
        },
        fragment: {
            module: shaderModule,
            entryPoint: "fragmentMain",
            targets: [{
                format: format
            }]
        },
        primitive: {
            topology: "line-list",
        },
        layout: "auto"
    });
    passEncoder.setPipeline(pipeline);
    passEncoder.setVertexBuffer(0, tBuffer);
    passEncoder.draw(totalPoints * 2);
    passEncoder.end();
    device.queue.submit([encoder.finish()]);
}

main()