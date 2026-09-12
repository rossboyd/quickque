// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "QuickqueFlow",
    platforms: [.macOS(.v26)],
    products: [
        .executable(name: "quickque-flow", targets: ["QuickqueFlow"]),
        .executable(name: "quickque-speech", targets: ["QuickqueSpeech"]),
    ],
    targets: [
        .executableTarget(
            name: "QuickqueFlow",
            dependencies: []
        ),
        .executableTarget(
            name: "QuickqueSpeech",
            dependencies: []
        ),
        .testTarget(name: "QuickqueFlowTests", dependencies: ["QuickqueFlow"])
    ]
)