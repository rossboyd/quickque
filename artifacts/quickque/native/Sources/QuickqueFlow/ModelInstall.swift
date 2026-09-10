import CryptoKit
import FluidAudio
import Foundation

extension FlowService {
    func modelsAreComplete() -> Bool {
        guard let installed = try? String(contentsOf: marker, encoding: .utf8)
            .split(separator: "\n").map(String.init),
              installed.count == 3, installed[0] == modelRevision,
              installed[1] == vadRevision, installed[2] == installationDigest()
        else { return false }
        let required = [
            eouDirectory.appendingPathComponent("streaming_encoder.mlmodelc"),
            eouDirectory.appendingPathComponent("decoder.mlmodelc"),
            eouDirectory.appendingPathComponent("joint_decision.mlmodelc"),
            eouDirectory.appendingPathComponent("vocab.json"), vadDirectory,
        ]
        return required.allSatisfy { nonempty($0) }
    }

    private func installationDigest() -> String {
        let files = [eouDirectory, vadDirectory].flatMap { directory -> [URL] in
            guard let enumerator = FileManager.default.enumerator(
                at: directory, includingPropertiesForKeys: [.isRegularFileKey])
            else { return [] }
            return enumerator.compactMap {
                guard let url = $0 as? URL,
                      (try? url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true
                else { return nil }
                return url
            }
        }.sorted { $0.path < $1.path }
        guard !files.isEmpty else { return "" }
        var digest = SHA256()
        for file in files {
            digest.update(data: Data(file.path.utf8))
            guard let stream = InputStream(url: file) else { return "" }
            stream.open()
            var buffer = [UInt8](repeating: 0, count: 1024 * 1024)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                guard count >= 0 else {
                    stream.close()
                    return ""
                }
                if count == 0 { break }
                digest.update(data: Data(buffer[0..<count]))
            }
            stream.close()
        }
        return digest.finalize().map { String(format: "%02x", $0) }.joined()
    }

    private func nonempty(_ url: URL) -> Bool {
        var directory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &directory) else {
            return false
        }
        if !directory.boolValue {
            return ((try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0) > 0
        }
        guard let enumerator = FileManager.default.enumerator(
            at: url, includingPropertiesForKeys: [.isRegularFileKey, .fileSizeKey])
        else { return false }
        for case let file as URL in enumerator {
            let values = try? file.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
            if values?.isRegularFile == true && (values?.fileSize ?? 0) > 0 { return true }
        }
        return false
    }

    func download() async {
        guard supported() else {
            await emitStatus("unsupported", message: FlowFailure.unsupported.localizedDescription)
            return
        }
        do {
            ModelHub.offlineMode = true
            let asr = try await immutableManifest(
                repository: "FluidInference/parakeet-realtime-eou-120m-coreml",
                revision: modelRevision).filter {
                    $0.type == "file" && ($0.path == "160ms/vocab.json"
                        || $0.path.hasPrefix("160ms/streaming_encoder.mlmodelc/")
                        || $0.path.hasPrefix("160ms/decoder.mlmodelc/")
                        || $0.path.hasPrefix("160ms/joint_decision.mlmodelc/"))
                }
            let vad = try await immutableManifest(
                repository: "FluidInference/silero-vad-coreml", revision: vadRevision
            ).filter {
                $0.type == "file"
                    && $0.path.hasPrefix("silero-vad-unified-256ms-v6.2.1.mlmodelc/")
            }
            guard !asr.isEmpty, !vad.isEmpty else { throw FlowFailure.missingModel }
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            try? FileManager.default.removeItem(at: marker)
            let total = asr.reduce(0) { $0 + $1.size } + vad.reduce(0) { $0 + $1.size }
            await emitStatus("downloading", progress: 0, totalBytes: total)
            var completed = 0
            completed = try await install(
                asr, repository: "FluidInference/parakeet-realtime-eou-120m-coreml",
                revision: modelRevision, destination: eouDirectory, strippingPrefix: "160ms/",
                completedBytes: completed, totalBytes: total)
            completed = try await install(
                vad, repository: "FluidInference/silero-vad-coreml", revision: vadRevision,
                destination: vadDirectory.deletingLastPathComponent(), strippingPrefix: "",
                completedBytes: completed, totalBytes: total)
            try Task.checkCancellation()
            let manager = StreamingEouAsrManager(chunkSize: .ms160, debugFeatures: false)
            try await manager.loadModels(to: modelsRoot)
            _ = try await VadManager(modelDirectory: root)
            let digest = installationDigest()
            guard !digest.isEmpty else { throw FlowFailure.missingModel }
            try Data("\(modelRevision)\n\(vadRevision)\n\(digest)\n".utf8)
                .write(to: marker, options: .atomic)
            await manager.cleanup()
            await emitStatus("ready", progress: 1, totalBytes: total)
        } catch is CancellationError {
        } catch {
            try? FileManager.default.removeItem(at: marker)
            await emitError("Model download or integrity verification failed: \(error.localizedDescription)")
            await emitStatus("needs-model", message: "Retry the model download.")
        }
    }

    private func immutableManifest(repository: String, revision: String) async throws -> [RemoteFile] {
        let url = URL(string:
            "https://huggingface.co/api/models/\(repository)/tree/\(revision)?recursive=true")!
        let (data, response) = try await URLSession.shared.data(from: url)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            throw NSError(domain: "QuickqueFlow", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "Could not read the immutable model manifest."
            ])
        }
        return try JSONDecoder().decode([RemoteFile].self, from: data)
    }

    private func install(
        _ files: [RemoteFile], repository: String, revision: String, destination: URL,
        strippingPrefix prefix: String, completedBytes: Int, totalBytes: Int
    ) async throws -> Int {
        var completedBytes = completedBytes
        for file in files.sorted(by: { $0.path < $1.path }) {
            try Task.checkCancellation()
            let relative = prefix.isEmpty ? file.path : String(file.path.dropFirst(prefix.count))
            let target = destination.appendingPathComponent(relative)
            try FileManager.default.createDirectory(
                at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
            let escaped = file.path.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed)!
            let url = URL(string:
                "https://huggingface.co/\(repository)/resolve/\(revision)/\(escaped)")!
            let (temporary, response) = try await URLSession.shared.download(from: url)
            guard (response as? HTTPURLResponse)?.statusCode == 200,
                  ((try? temporary.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? -1) == file.size
            else {
                throw NSError(domain: "QuickqueFlow", code: 2, userInfo: [
                    NSLocalizedDescriptionKey: "An immutable model file failed size verification."
                ])
            }
            let partial = target.appendingPathExtension("partial")
            try? FileManager.default.removeItem(at: partial)
            try FileManager.default.moveItem(at: temporary, to: partial)
            try? FileManager.default.removeItem(at: target)
            try FileManager.default.moveItem(at: partial, to: target)
            completedBytes += file.size
            await emitStatus(
                "downloading", progress: Double(completedBytes) / Double(max(1, totalBytes)),
                totalBytes: totalBytes)
        }
        return completedBytes
    }
}