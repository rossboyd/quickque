import Darwin
import Foundation
import XCTest
@testable import QuickqueFlow

final class PipeReadTests: XCTestCase {
    func testShortCommandReturnsWhileWriterRemainsOpen() throws {
        var descriptors = [Int32](repeating: -1, count: 2)
        let pipeResult = descriptors.withUnsafeMutableBufferPointer { buffer in
            Darwin.pipe(buffer.baseAddress!)
        }
        XCTAssertEqual(pipeResult, 0)
        guard pipeResult == 0 else { return }

        let reader = descriptors[0]
        let writer = descriptors[1]
        defer {
            Darwin.close(reader)
            Darwin.close(writer)
        }

        var command = Data(#"{"action":"status","generation":42}"#.utf8)
        command.append(0x0a)
        let written = command.withUnsafeBytes { bytes in
            Darwin.write(writer, bytes.baseAddress, bytes.count)
        }
        XCTAssertEqual(written, command.count)

        // The writer deliberately remains open. A pipe read must still return
        // the available short command instead of waiting for the 64 KiB limit.
        let received = try XCTUnwrap(
            readPipeChunk(fileDescriptor: reader, maximumBytes: 64 * 1024))
        XCTAssertEqual(received, command)
    }

    func testPipeEndOfFileReturnsNil() throws {
        var descriptors = [Int32](repeating: -1, count: 2)
        let pipeResult = descriptors.withUnsafeMutableBufferPointer { buffer in
            Darwin.pipe(buffer.baseAddress!)
        }
        XCTAssertEqual(pipeResult, 0)
        guard pipeResult == 0 else { return }

        let reader = descriptors[0]
        Darwin.close(descriptors[1])
        defer { Darwin.close(reader) }

        XCTAssertNil(try readPipeChunk(fileDescriptor: reader))
    }
}