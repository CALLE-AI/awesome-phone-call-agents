using System.Security.Cryptography;

namespace CareCall.Web.Services;

public interface IJudgeAccess
{
    bool IsAuthorized(string? password);
}

public sealed class JudgeAccessService(IConfiguration configuration) : IJudgeAccess
{
    private const int SaltBytes = 16;
    private const int HashBytes = 32;
    private const int MinimumIterations = 100_000;

    public bool IsAuthorized(string? password)
    {
        var encodedHash = configuration["JudgeAccess:PasswordHash"];
        if (string.IsNullOrWhiteSpace(password) || string.IsNullOrWhiteSpace(encodedHash))
            return false;

        var parts = encodedHash.Split(':');
        if (parts.Length != 3 || !int.TryParse(parts[0], out var iterations) || iterations < MinimumIterations)
            return false;

        try
        {
            var salt = Convert.FromBase64String(parts[1]);
            var expected = Convert.FromBase64String(parts[2]);
            if (salt.Length != SaltBytes || expected.Length != HashBytes)
                return false;

            var actual = Rfc2898DeriveBytes.Pbkdf2(password, salt, iterations, HashAlgorithmName.SHA256, HashBytes);
            return CryptographicOperations.FixedTimeEquals(actual, expected);
        }
        catch (FormatException)
        {
            return false;
        }
    }
}
