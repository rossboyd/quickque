// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "QuickqueFlow",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "quickque-flow", targets: ["QuickqueFlow"])],
    dependencies: [
        .package(
            url: "https://github.com/FluidInference/FluidAudio.git",
            revision: "41540ea237350afe5117a082b5c28eda642d0612"
        )
    ],
    targets: [
        .executableTarget(
            name: "QuickqueFlow",
            dependencies: [.product(name: "FluidAudio", package: "FluidAudio")]
        ),
        .testTarget(name: "QuickqueFlowTests", dependencies: ["QuickqueFlow"])
    ]
)