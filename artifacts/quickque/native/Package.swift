// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "QuickqueFlow",
    platforms: [.macOS(.v26)],
    products: [.executable(name: "quickque-flow", targets: ["QuickqueFlow"])],
    targets: [
        .executableTarget(
            name: "QuickqueFlow",
            dependencies: []
        ),
        .testTarget(name: "QuickqueFlowTests", dependencies: ["QuickqueFlow"])
    ]
)