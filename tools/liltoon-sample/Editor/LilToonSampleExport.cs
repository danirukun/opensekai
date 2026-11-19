using System;
using System.IO;
using System.Linq;
using System.Text;
using Mochiya.AvatarTools.Editor;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;

/// <summary>
/// Exports the lilToon sample scene to a VRM with MOCHIYA_materials_liltoon, writes versions.json,
/// and renders the Unity reference capture.
/// Run: Unity -batchmode -quit -projectPath ... -executeMethod LilToonSampleExport.Run
/// Then: Unity -batchmode -quit -projectPath ... -executeMethod LilToonSampleExport.Capture
/// </summary>
public static class LilToonSampleExport
{
    public const string ExportFileName = "Catboy-lilToon.vrm";
    public const int CaptureWidth = 1920;
    public const int CaptureHeight = 1080;

    private static string ExportDirectory => Path.Combine(Path.GetDirectoryName(Application.dataPath), "Export");

    [MenuItem("OpenSekai/Export lilToon sample")]
    public static void Run()
    {
        try
        {
            Export();
        }
        catch (Exception e)
        {
            Debug.LogError($"LilToonSampleExport failed: {e}");
            if (Application.isBatchMode) EditorApplication.Exit(1);
            throw;
        }
    }

    [MenuItem("OpenSekai/Capture lilToon reference")]
    public static void Capture()
    {
        try
        {
            CaptureReference();
        }
        catch (Exception e)
        {
            Debug.LogError($"LilToonSampleExport capture failed: {e}");
            if (Application.isBatchMode) EditorApplication.Exit(1);
            throw;
        }
    }

    private static GameObject OpenSampleRoot()
    {
        EditorSceneManager.OpenScene(LilToonSampleConvert.ScenePath, OpenSceneMode.Single);
        var root = GameObject.Find(LilToonSampleConvert.RootName);
        if (root == null) throw new InvalidOperationException($"No {LilToonSampleConvert.RootName} in {LilToonSampleConvert.ScenePath}. Run LilToonSampleConvert.Run first.");
        return root;
    }

    private static void Export()
    {
        var root = OpenSampleRoot();
        Directory.CreateDirectory(ExportDirectory);
        var path = Path.Combine(ExportDirectory, ExportFileName);

        var detected = MochiyaAvatarWorkflow.Detect(root);
        Debug.Log($"Mochiya detect: kind={detected.Kind} prepared={detected.IsPrepared} reason={detected.Reason} error={detected.Error}");

        var profile = ScriptableObject.CreateInstance<MochiyaExportProfile>();
        profile.UseAttachedVrmMetadata = true;
        try
        {
            var report = MochiyaAvatarWorkflow.Export(root, path, profile);
            Debug.Log($"Mochiya export report:\n{report}");
            if (!report.CanConvert) throw new InvalidOperationException(report.ToString());
        }
        finally
        {
            UnityEngine.Object.DestroyImmediate(profile);
        }

        var size = new FileInfo(path).Length;
        Debug.Log($"Exported {path} ({size} bytes).");
        WriteVersions("mochiya");
    }

    private static void WriteVersions(string exportPath)
    {
        var packages = UnityEditor.PackageManager.PackageInfo.GetAllRegisteredPackages();
        string Version(string name) => packages.FirstOrDefault(p => p.name == name)?.version ?? "unknown";
        string Commit(string name) => packages.FirstOrDefault(p => p.name == name)?.git?.hash ?? "unknown";
        var json = "{\n"
            + $"  \"unity\": \"{Application.unityVersion}\",\n"
            + $"  \"univrm\": \"{Version("com.vrmc.vrm")}\",\n"
            + $"  \"liltoon\": \"{Version("jp.lilxyzw.liltoon")}\",\n"
            + $"  \"mochiyaAvatarTools\": \"{Commit("org.mochiya.avatar-tools")}\",\n"
            + $"  \"exportPath\": \"{exportPath}\"\n"
            + "}\n";
        var file = Path.Combine(ExportDirectory, "versions.json");
        File.WriteAllText(file, json, new UTF8Encoding(false));
        Debug.Log($"Wrote {file}:\n{json}");
    }

    // Renders the reference camera to a render texture and writes the PNG.
    // Batch mode has no Game view, so ScreenCapture.CaptureScreenshot is not used.
    private static void CaptureReference()
    {
        OpenSampleRoot();
        var cameraObject = GameObject.Find(LilToonSampleConvert.CameraName);
        var lightObject = GameObject.Find(LilToonSampleConvert.LightName);
        if (cameraObject == null || lightObject == null) throw new InvalidOperationException("The sample scene has no reference camera or light.");
        var camera = cameraObject.GetComponent<Camera>();
        var light = lightObject.GetComponent<Light>();

        // Re-assert the reference values so that a hand edit of the scene does not change the capture.
        light.type = LightType.Directional;
        light.color = Color.white;
        light.intensity = LilToonSampleConvert.LightIntensity;
        light.shadows = LightShadows.None;
        lightObject.transform.rotation = Quaternion.Euler(LilToonSampleConvert.LightRotation);
        RenderSettings.ambientMode = AmbientMode.Flat;
        RenderSettings.ambientLight = LilToonSampleConvert.AmbientColor;
        cameraObject.transform.position = LilToonSampleConvert.CameraPosition;
        cameraObject.transform.LookAt(LilToonSampleConvert.CameraTarget);
        camera.fieldOfView = LilToonSampleConvert.CameraFieldOfView;
        camera.nearClipPlane = 0.05f;
        camera.farClipPlane = 20f;
        camera.clearFlags = CameraClearFlags.SolidColor;
        camera.backgroundColor = LilToonSampleConvert.CameraBackground;
        camera.allowHDR = false;
        camera.allowMSAA = false;
        camera.aspect = (float)CaptureWidth / CaptureHeight;
        EditorSceneManager.SaveScene(cameraObject.scene);
        var forward = lightObject.transform.forward;
        Debug.Log($"Reference light forward: ({forward.x:F4}, {forward.y:F4}, {forward.z:F4}); camera MSAA off, quality antiAliasing {QualitySettings.antiAliasing}");

        ShaderUtil.allowAsyncCompilation = false;
        var rt = new RenderTexture(CaptureWidth, CaptureHeight, 24, RenderTextureFormat.ARGB32, RenderTextureReadWrite.Default);
        var previousTarget = camera.targetTexture;
        var previousActive = RenderTexture.active;
        try
        {
            camera.targetTexture = rt;
            camera.Render();
            camera.Render();
            RenderTexture.active = rt;
            var image = new Texture2D(CaptureWidth, CaptureHeight, TextureFormat.RGBA32, false);
            image.ReadPixels(new Rect(0, 0, CaptureWidth, CaptureHeight), 0, 0);
            image.Apply();
            Directory.CreateDirectory(ExportDirectory);
            var file = Path.Combine(ExportDirectory, "unity-reference.png");
            File.WriteAllBytes(file, image.EncodeToPNG());
            UnityEngine.Object.DestroyImmediate(image);
            Debug.Log($"Wrote {file} ({CaptureWidth}x{CaptureHeight}, color space {QualitySettings.activeColorSpace}).");
        }
        finally
        {
            camera.targetTexture = previousTarget;
            RenderTexture.active = previousActive;
            UnityEngine.Object.DestroyImmediate(rt);
        }
    }
}
